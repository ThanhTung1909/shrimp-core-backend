import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, beforeAll, afterAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { NotificationTokensService } from '../src/modules/notifications/notification-tokens.service.js';

const TEST_DATABASE = 'shrimp_p12_token_ownership_e2e';
const runE2e =
  process.env.P1_2_FCM_OWNERSHIP_E2E === 'true' &&
  process.env.DB_NAME === TEST_DATABASE;
const databaseDescribe = runE2e ? describe : describe.skip;

type App = Parameters<typeof request>[0];

databaseDescribe('P1-2 FCM token ownership HTTP E2E', () => {
  let app: INestApplication<App>;
  let client: Client;
  let jwt: JwtService;
  let tokensService: NotificationTokensService;
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ownedToken = 'e2e-owned-token';

  const authHeader = (userId: string) => {
    const accessToken = jwt.sign({
      sub: userId,
      tokenVersion: 0,
      role: 'FARMER',
      type: 'access',
      jti: randomUUID(),
    });
    return `Bearer ${accessToken}`;
  };

  beforeAll(async () => {
    config();
    client = new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: TEST_DATABASE,
    });
    await client.connect();
    const database = await client.query('SELECT current_database() AS database_name');
    expect(database.rows[0].database_name).toBe(TEST_DATABASE);

    await client.query('DELETE FROM users');
    await client.query(
      `INSERT INTO users (user_id, full_name, phone_number, password_hash, role)
       VALUES ($1, 'Token Owner A', '0900000001', 'test', 'FARMER'),
              ($2, 'Token Owner B', '0900000002', 'test', 'FARMER')`,
      [userA, userB],
    );

    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    await app.init();
    jwt = fixture.get(JwtService);
    tokensService = fixture.get(NotificationTokensService);
  });

  afterAll(async () => {
    await app?.close();
    await client?.end();
  });

  it('enforces active-token ownership, idempotency, handoff, and non-disclosure', async () => {
    const first = await request(app.getHttpServer())
      .post('/notifications/fcm-tokens')
      .set('Authorization', authHeader(userA))
      .send({ token: ownedToken, platform: 'android' })
      .expect(200);
    expect(first.body).not.toHaveProperty('token');
    expect(first.body).toMatchObject({ platform: 'android', isActive: true });

    await request(app.getHttpServer())
      .post('/notifications/fcm-tokens')
      .set('Authorization', authHeader(userA))
      .send({ token: ownedToken, platform: 'android' })
      .expect(200);
    expect(
      (await client.query('SELECT count(*)::int AS count FROM notification_token WHERE token = $1', [ownedToken]))
        .rows,
    ).toEqual([{ count: 1 }]);

    await request(app.getHttpServer())
      .post('/notifications/fcm-tokens')
      .set('Authorization', authHeader(userB))
      .send({ token: ownedToken })
      .expect(403);

    await request(app.getHttpServer())
      .delete('/notifications/fcm-tokens')
      .set('Authorization', authHeader(userB))
      .send({ token: ownedToken })
      .expect(403);

    await request(app.getHttpServer())
      .delete('/notifications/fcm-tokens')
      .set('Authorization', authHeader(userA))
      .send({ token: ownedToken })
      .expect(200);

    await request(app.getHttpServer())
      .post('/notifications/fcm-tokens')
      .set('Authorization', authHeader(userB))
      .send({ token: ownedToken, platform: 'ios' })
      .expect(200);

    expect(
      (await client.query(
        'SELECT user_id, is_active FROM notification_token WHERE token = $1',
        [ownedToken],
      )).rows,
    ).toEqual([{ user_id: userB, is_active: true }]);
    expect((await client.query('SELECT fcm_token FROM users WHERE user_id = $1', [userA])).rows)
      .toEqual([{ fcm_token: null }]);
    expect(await tokensService.getActiveTokens(userA)).toEqual([]);
    expect(await tokensService.getActiveTokens(userB)).toEqual([ownedToken]);
  });

  it('allows only one concurrent registration to claim a fresh token', async () => {
    const raceToken = 'e2e-concurrent-token';
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post('/notifications/fcm-tokens')
        .set('Authorization', authHeader(userA))
        .send({ token: raceToken }),
      request(app.getHttpServer())
        .post('/notifications/fcm-tokens')
        .set('Authorization', authHeader(userB))
        .send({ token: raceToken }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const owner = await client.query(
      'SELECT user_id FROM notification_token WHERE token = $1',
      [raceToken],
    );
    expect(owner.rows).toHaveLength(1);
    expect([userA, userB]).toContain(owner.rows[0].user_id);
  });
});
