/**
 * Applies the P1-2 notification schema migration to one explicitly confirmed
 * database. It deliberately has no default database target and is never run
 * by application startup.
 *
 * Example (staging/test only):
 * npm run migrate:p1-2 -- --database shrimp_staging --confirm-database shrimp_staging
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const database = valueAfter('--database');
const confirmation = valueAfter('--confirm-database');

if (!database || !confirmation || database !== confirmation) {
  throw new Error(
    'Refusing to run without matching --database <name> and --confirm-database <name>.',
  );
}

if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/u.test(database)) {
  throw new Error('Database name contains unsupported characters.');
}

function parseDotEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, ''),
        ];
      }),
  );
}

let env = {};
try {
  env = parseDotEnv(await readFile(path.join(root, '.env'), 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const client = new Client({
  host: process.env.PGHOST ?? process.env.DB_HOST ?? env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? process.env.DB_PORT ?? env.DB_PORT ?? 5432),
  user: process.env.PGUSER ?? process.env.DB_USER ?? env.DB_USER,
  password: process.env.PGPASSWORD ?? process.env.DB_PASS ?? env.DB_PASS,
  database,
});

const migration = await readFile(
  path.join(root, 'database', 'migrations', '20261013_p12_notification_tables.sql'),
  'utf8',
);

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(migration);
  await client.query('COMMIT');
  console.log(`P1-2 notification migration applied to ${database}.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
