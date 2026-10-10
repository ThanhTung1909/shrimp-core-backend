/**
 * Creates and verifies a dedicated PostgreSQL fixture database for the P0
 * isLocked transition. It refuses to run when the fixture already exists.
 *
 * Usage:
 *   node test/islocked-migration-verify.mjs --check-only
 *   node test/islocked-migration-verify.mjs
 *   node test/islocked-migration-verify.mjs --database shrimp_islocked_migration_verify_retry
 *
 * Connection settings are read from .env (DB_HOST, DB_PORT, DB_USER, DB_PASS)
 * or standard PG* environment variables. DB_NAME is deliberately ignored.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const defaultFixtureDatabase = 'shrimp_islocked_migration_verify';
const databaseOptionIndex = process.argv.indexOf('--database');
const fixtureDatabase =
  databaseOptionIndex === -1
    ? defaultFixtureDatabase
    : process.argv[databaseOptionIndex + 1];

if (!/^[a-z][a-z0-9_]{0,62}$/u.test(fixtureDatabase ?? '')) {
  throw new Error('Fixture database name must be a lowercase PostgreSQL identifier.');
}
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(
  projectRoot,
  'database',
  'migrations',
  '20261010_p03_transition_to_islocked.sql',
);

function parseDotEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadConnectionOptions(database) {
  let dotEnv = {};
  try {
    dotEnv = parseDotEnv(await readFile(path.join(projectRoot, '.env'), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return {
    host: process.env.PGHOST ?? process.env.DB_HOST ?? dotEnv.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? process.env.DB_PORT ?? dotEnv.DB_PORT ?? 5432),
    user: process.env.PGUSER ?? process.env.DB_USER ?? dotEnv.DB_USER,
    password: process.env.PGPASSWORD ?? process.env.DB_PASS ?? dotEnv.DB_PASS,
    database,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function executeMigration(client, migration) {
  await client.query(migration);
}

async function resetUsersTable(client) {
  // This is a new, dedicated fixture database. Only the table made by this
  // verifier is removed between isolated scenarios; no existing DB is touched.
  await client.query('DROP TABLE IF EXISTS public.users');
}

async function usersColumn(client, columnName) {
  const result = await client.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = $1`,
    [columnName],
  );
  return result.rows[0] ?? null;
}

async function assertCurrentColumn(client) {
  const column = await usersColumn(client, 'isLocked');
  assert(column, 'expected public.users."isLocked" to exist');
  assert(column.data_type === 'boolean', `expected boolean, got ${column.data_type}`);
  assert(column.is_nullable === 'NO', 'expected "isLocked" to be NOT NULL');
  assert(
    column.column_default?.includes('false'),
    `expected default false, got ${column.column_default}`,
  );
}

async function assertLegacyColumnsPreserved(client) {
  for (const columnName of ['is_login_locked', 'lock_reason', 'locked_at', 'locked_by']) {
    assert(await usersColumn(client, columnName), `expected legacy ${columnName} to remain`);
  }
}

async function runScenario(client, name, setup, verify, migration) {
  await resetUsersTable(client);
  await setup();
  await executeMigration(client, migration);
  await verify();
  await executeMigration(client, migration);
  await verify();
  console.log(`PASS ${name}: first run and idempotent second run`);
}

async function run() {
  const checkOnly = process.argv.includes('--check-only');
  const admin = new Client(await loadConnectionOptions('postgres'));
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [fixtureDatabase]);
    if (existing.rowCount) {
      throw new Error(`Fixture database ${fixtureDatabase} already exists; refusing to overwrite it.`);
    }
    if (checkOnly) {
      console.log(`PASS fixture database name is available: ${fixtureDatabase}`);
      return;
    }
    await admin.query(`CREATE DATABASE ${fixtureDatabase}`);
  } finally {
    await admin.end();
  }

  const migration = await readFile(migrationPath, 'utf8');
  const client = new Client(await loadConnectionOptions(fixtureDatabase));
  await client.connect();
  try {
    await runScenario(
      client,
      'new schema without lock columns',
      async () => {
        await client.query('CREATE TABLE public.users (id integer PRIMARY KEY, email text NOT NULL)');
        await client.query("INSERT INTO public.users (id, email) VALUES (1, 'new-locked-check@example.test'), (2, 'new-unlocked-check@example.test')");
      },
      async () => {
        await assertCurrentColumn(client);
        const result = await client.query('SELECT "isLocked" FROM public.users ORDER BY id');
        assert(result.rows.every((row) => row.isLocked === false), 'new rows must normalize to false');
      },
      migration,
    );

    await runScenario(
      client,
      'legacy schema preserves lock and metadata',
      async () => {
        await client.query(`CREATE TABLE public.users (
          id integer PRIMARY KEY,
          is_login_locked boolean,
          lock_reason varchar(30),
          locked_at timestamptz,
          locked_by uuid
        )`);
        await client.query(`INSERT INTO public.users
          (id, is_login_locked, lock_reason, locked_at, locked_by)
          VALUES
            (1, true, 'LEGACY_LOCK', '2026-10-10T00:00:00Z', '11111111-1111-1111-1111-111111111111'),
            (2, false, NULL, NULL, NULL)`);
      },
      async () => {
        await assertCurrentColumn(client);
        await assertLegacyColumnsPreserved(client);
        const result = await client.query(
          'SELECT id, "isLocked", is_login_locked, lock_reason, locked_at, locked_by FROM public.users ORDER BY id',
        );
        assert(result.rows[0].isLocked === true, 'legacy locked user became unlocked');
        assert(result.rows[1].isLocked === false, 'legacy unlocked user became locked');
        assert(result.rows[0].lock_reason === 'LEGACY_LOCK', 'legacy metadata changed');
        assert(result.rows[0].locked_by === '11111111-1111-1111-1111-111111111111', 'legacy lock owner changed');
      },
      migration,
    );

    await runScenario(
      client,
      'transitional schema merges both columns with OR semantics',
      async () => {
        await client.query('CREATE TABLE public.users (id integer PRIMARY KEY, "isLocked" boolean, is_login_locked boolean)');
        await client.query(`INSERT INTO public.users (id, "isLocked", is_login_locked) VALUES
          (1, false, true), (2, true, false), (3, false, false),
          (4, true, true), (5, NULL, true), (6, true, NULL), (7, NULL, NULL)`);
      },
      async () => {
        await assertCurrentColumn(client);
        const result = await client.query('SELECT id, "isLocked" FROM public.users ORDER BY id');
        const expected = [true, true, false, true, true, true, false];
        assert(
          result.rows.every((row, index) => row.isLocked === expected[index]),
          `unexpected OR merge result: ${JSON.stringify(result.rows)}`,
        );
      },
      migration,
    );

    await runScenario(
      client,
      'current schema preserves existing true values',
      async () => {
        await client.query('CREATE TABLE public.users (id integer PRIMARY KEY, "isLocked" boolean)');
        await client.query('INSERT INTO public.users (id, "isLocked") VALUES (1, true), (2, false), (3, NULL)');
      },
      async () => {
        await assertCurrentColumn(client);
        const result = await client.query('SELECT id, "isLocked" FROM public.users ORDER BY id');
        assert(
          JSON.stringify(result.rows.map((row) => row.isLocked)) === JSON.stringify([true, false, false]),
          'current lock state was not preserved',
        );
      },
      migration,
    );

    await resetUsersTable(client);
    await client.query('CREATE TABLE public.users (id integer PRIMARY KEY, is_login_locked text)');
    await client.query("INSERT INTO public.users (id, is_login_locked) VALUES (1, 'true')");
    try {
      await executeMigration(client, migration);
      throw new Error('expected legacy non-boolean schema to fail');
    } catch (error) {
      assert(/is_login_locked must be boolean/u.test(error.message), `unexpected failure: ${error.message}`);
      await client.query('ROLLBACK');
    }
    assert((await usersColumn(client, 'isLocked')) === null, 'failed migration must roll back added column');
    console.log('PASS abnormal legacy type fails closed and rolls back');

    await resetUsersTable(client);
    await client.query('CREATE TABLE public.users (id integer PRIMARY KEY, islocked boolean)');
    try {
      await executeMigration(client, migration);
      throw new Error('expected ambiguous casing schema to fail');
    } catch (error) {
      assert(/ambiguous lock column/u.test(error.message), `unexpected failure: ${error.message}`);
      await client.query('ROLLBACK');
    }
    assert((await usersColumn(client, 'isLocked')) === null, 'ambiguous schema must not be modified');
    console.log('PASS ambiguous identifier casing fails closed and rolls back');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(`FAIL isLocked migration verification: ${error.message}`);
  process.exitCode = 1;
});
