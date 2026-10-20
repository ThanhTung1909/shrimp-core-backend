import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DATABASE = 'shrimp_p12_integration_test';
const runDatabaseIntegration =
  process.env.P1_2_POSTGRES_INTEGRATION === 'true' &&
  process.env.P1_2_TEST_DATABASE === TEST_DATABASE;
const databaseDescribe = runDatabaseIntegration ? describe : describe.skip;

function readLocalDatabaseConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0 && !line.trimStart().startsWith('#')) {
      config[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return config;
}

databaseDescribe('P1-2 PostgreSQL integration', () => {
  let client: Client;
  const fixtureUserIds: string[] = [];

  async function createFixtureUser(): Promise<string> {
    const userId = randomUUID();
    fixtureUserIds.push(userId);
    await client.query('INSERT INTO users (user_id) VALUES ($1)', [userId]);
    return userId;
  }

  beforeAll(async () => {
    const config = readLocalDatabaseConfig();
    client = new Client({
      host: config.DB_HOST,
      port: Number(config.DB_PORT || 5432),
      user: config.DB_USER,
      password: config.DB_PASS,
      database: TEST_DATABASE,
    });
    await client.connect();
    const result = await client.query('SELECT current_database() AS database_name');
    expect(result.rows[0].database_name).toBe(TEST_DATABASE);
  });

  afterAll(async () => {
    if (fixtureUserIds.length > 0) {
      await client.query('DELETE FROM users WHERE user_id = ANY($1::uuid[])', [fixtureUserIds]);
    }
    await client.end();
  });

  it('persists preferences and tokens independently for each severity', async () => {
    const userId = await createFixtureUser();

    await client.query(
      `INSERT INTO notification_preference (user_id, severity, channel, enabled)
       VALUES ($1, 'CRITICAL', 'SMS', true), ($1, 'CRITICAL', 'EMAIL', false),
              ($1, 'WARNING', 'SMS', false), ($1, 'WARNING', 'EMAIL', true)`,
      [userId],
    );
    await client.query(
      `INSERT INTO notification_token (user_id, token, platform, is_active)
       VALUES ($1, 'fixture-device-token', 'android', true)`,
      [userId],
    );

    const preferences = await client.query(
      `SELECT severity, channel, enabled
       FROM notification_preference WHERE user_id = $1 ORDER BY severity, channel`,
      [userId],
    );
    const token = await client.query(
      'SELECT token, is_active FROM notification_token WHERE user_id = $1',
      [userId],
    );

    expect(preferences.rows).toEqual([
      { severity: 'WARNING', channel: 'SMS', enabled: false },
      { severity: 'WARNING', channel: 'EMAIL', enabled: true },
      { severity: 'CRITICAL', channel: 'SMS', enabled: true },
      { severity: 'CRITICAL', channel: 'EMAIL', enabled: false },
    ]);
    expect(token.rows).toEqual([{ token: 'fixture-device-token', is_active: true }]);
  });

  it('keeps preferences isolated by user', async () => {
    const userA = await createFixtureUser();
    const userB = await createFixtureUser();
    await client.query(
      `INSERT INTO notification_preference (user_id, severity, channel, enabled)
       VALUES ($1, 'CRITICAL', 'SMS', true), ($2, 'CRITICAL', 'SMS', false)`,
      [userA, userB],
    );

    const userAPreferences = await client.query(
      'SELECT enabled FROM notification_preference WHERE user_id = $1',
      [userA],
    );
    const userBPreferences = await client.query(
      'SELECT enabled FROM notification_preference WHERE user_id = $1',
      [userB],
    );

    expect(userAPreferences.rows).toEqual([{ enabled: true }]);
    expect(userBPreferences.rows).toEqual([{ enabled: false }]);
  });

  it('enforces delivery uniqueness and provider-accepted status semantics', async () => {
    const userId = await createFixtureUser();
    const alertId = randomUUID();
    await client.query(
      `INSERT INTO notification_delivery (alert_id, user_id, channel, status)
       VALUES ($1, $2, 'FCM', 'PROVIDER_ACCEPTED')`,
      [alertId, userId],
    );

    await expect(
      client.query(
        `INSERT INTO notification_delivery (alert_id, user_id, channel, status)
         VALUES ($1, $2, 'FCM', 'PENDING')`,
        [alertId, userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const delivery = await client.query(
      `SELECT status, attempt_count FROM notification_delivery
       WHERE alert_id = $1 AND user_id = $2 AND channel = 'FCM'`,
      [alertId, userId],
    );
    expect(delivery.rows).toEqual([{ status: 'PROVIDER_ACCEPTED', attempt_count: 1 }]);
  });

  it('allows exactly one concurrent delivery claim while other channels remain available', async () => {
    const userId = await createFixtureUser();
    const alertId = randomUUID();
    const config = readLocalDatabaseConfig();
    const secondClient = new Client({
      host: config.DB_HOST,
      port: Number(config.DB_PORT || 5432),
      user: config.DB_USER,
      password: config.DB_PASS,
      database: TEST_DATABASE,
    });
    await secondClient.connect();
    const insertFcm = (db: Client) =>
      db.query(
        `INSERT INTO notification_delivery (alert_id, user_id, channel, status)
         VALUES ($1, $2, 'FCM', 'PROCESSING')`,
        [alertId, userId],
      );

    try {
      const claims = await Promise.allSettled([insertFcm(client), insertFcm(secondClient)]);
      expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
      expect(claims.filter((claim) => claim.status === 'rejected')[0]).toMatchObject({
        reason: { code: '23505' },
      });

      await client.query(
        `INSERT INTO notification_delivery (alert_id, user_id, channel, status)
         VALUES ($1, $2, 'SMS', 'PENDING'), ($1, $2, 'EMAIL', 'PENDING')`,
        [alertId, userId],
      );
      const deliveries = await client.query(
        `SELECT channel FROM notification_delivery
         WHERE alert_id = $1 AND user_id = $2 ORDER BY channel`,
        [alertId, userId],
      );
      expect(deliveries.rows).toEqual([
        { channel: 'FCM' },
        { channel: 'SMS' },
        { channel: 'EMAIL' },
      ]);
    } finally {
      await secondClient.end();
    }
  });

  it('persists retry state and leaves no data after a rolled-back transaction', async () => {
    const userId = await createFixtureUser();
    const alertId = randomUUID();
    await client.query(
      `INSERT INTO notification_delivery (alert_id, user_id, channel, status, attempt_count, failure_code)
       VALUES ($1, $2, 'SMS', 'FAILED', 1, 'SMS_GATEWAY_ERROR')`,
      [alertId, userId],
    );
    const retry = await client.query(
      `UPDATE notification_delivery
       SET status = 'PROCESSING', attempt_count = attempt_count + 1, last_attempt_at = now()
       WHERE alert_id = $1 AND user_id = $2 AND channel = 'SMS' AND status = 'FAILED'
       RETURNING status, attempt_count`,
      [alertId, userId],
    );
    expect(retry.rows).toEqual([{ status: 'PROCESSING', attempt_count: 2 }]);

    const rollbackUserId = await createFixtureUser();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO notification_preference (user_id, severity, channel, enabled)
       VALUES ($1, 'WARNING', 'FCM', true)`,
      [rollbackUserId],
    );
    await client.query('ROLLBACK');
    const rolledBack = await client.query(
      'SELECT count(*)::int AS count FROM notification_preference WHERE user_id = $1',
      [rollbackUserId],
    );
    expect(rolledBack.rows).toEqual([{ count: 0 }]);
  });
});
