/**
 * Bằng chứng nghiệm thu PostgreSQL có opt-in cho AQS-101.
 *
 * Suite này không bao giờ dùng database cấu hình thông thường. Nó chỉ tạo rồi
 * xóa đúng một fixture database cục bộ khi có đủ các biến môi trường opt-in.
 * HTTP server chỉ dành cho test kiểm tra fetch, mapper, TypeORM entity và luồng
 * PostgreSQL persistence thực tế mà không thay đổi approval state FastAPI hoặc
 * phát cảnh báo vận hành.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../src/common/enums/role.enum.js';
import { PondStatus } from '../src/common/enums/pond-status.enum.js';
import { RiskLevel } from '../src/common/enums/risk-level.enum.js';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';
import { AiRecommendation } from '../src/modules/alerts/entities/ai-recommendation.entity.js';
import { Alert } from '../src/modules/alerts/entities/alert.entity.js';
import { ShrimpBatch } from '../src/modules/crops/entities/shrimp-batch.entity.js';
import { HarvestLog } from '../src/modules/crops/entities/harvest-log.entity.js';
import { Device } from '../src/modules/devices/entities/device.entity.js';
import { Farm } from '../src/modules/farms/entities/farm.entity.js';
import { NotificationDelivery } from '../src/modules/notifications/entities/notification-delivery.entity.js';
import { NotificationPreference } from '../src/modules/notifications/entities/notification-preference.entity.js';
import { NotificationToken } from '../src/modules/notifications/entities/notification-token.entity.js';
import { AiPrediction } from '../src/modules/predictions/entities/ai-prediction.entity.js';
import { PredictionsService } from '../src/modules/predictions/predictions.service.js';
import { ManualTestLog } from '../src/modules/ponds/entities/manual-test-log.entity.js';
import { PondFarmerAssignment } from '../src/modules/ponds/entities/pond-farmer-assignment.entity.js';
import { Pond } from '../src/modules/ponds/entities/pond.entity.js';
import { ThresholdConfig } from '../src/modules/ponds/entities/threshold-config.entity.js';
import { TelemetryData } from '../src/modules/telemetry/entities/telemetry-data.entity.js';
import { TelemetryIngestReceipt } from '../src/modules/telemetry/entities/telemetry-ingest-receipt.entity.js';
import { User } from '../src/modules/users/entities/user.entity.js';

const TEST_DATABASE = 'shrimp_aqs101_prediction_e2e';
const SAFE_FIXTURE_TELEMETRY_AGE_MS = 1_000;
const realFastApiUrl = process.env.AQS101_REAL_FASTAPI_URL;
const runAcceptanceE2e =
  process.env.AQS101_POSTGRES_INTEGRATION === 'true'
  && process.env.AQS101_TEST_DATABASE === TEST_DATABASE
  && Boolean(process.env.AQS101_TEST_DB_HOST)
  && Boolean(process.env.AQS101_TEST_DB_PORT)
  && Boolean(process.env.AQS101_TEST_DB_USER);
const databaseDescribe = runAcceptanceE2e ? describe : describe.skip;

type FixtureResponse = {
  status: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
};

function readEnvironmentFile(): Record<string, string> {
  const config: Record<string, string> = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0 && !line.trimStart().startsWith('#')) {
      config[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return config;
}

function readIsolatedDatabaseConfig(): Record<string, string> {
  const coreConfig = readEnvironmentFile();
  const host = process.env.AQS101_TEST_DB_HOST;
  const port = process.env.AQS101_TEST_DB_PORT;
  const user = process.env.AQS101_TEST_DB_USER;

  if (!host || !port || !user) {
    throw new Error('AQS-101 E2E requires explicit AQS101_TEST_DB_HOST/PORT/USER values.');
  }
  if (host === coreConfig.DB_HOST && port === coreConfig.DB_PORT) {
    throw new Error('AQS-101 E2E refuses to use the ordinary Core database endpoint.');
  }

  return {
    DB_HOST: host,
    DB_PORT: port,
    DB_USER: user,
    DB_PASS: process.env.AQS101_TEST_DB_PASS ?? '',
  };
}

function isLocalDatabaseHost(host: string | undefined): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && isLocalDatabaseHost(url.hostname);
  } catch {
    return false;
  }
}

databaseDescribe('AQS-101 PostgreSQL prediction persistence acceptance', () => {
  let dataSource: DataSource;
  let adminClient: Client;
  let fixtureServer: Server;
  let fixtureUrl: string;
  let databaseCreated = false;
  let pond: Pond;
  let fixtureResponse: FixtureResponse;
  let receivedPayloads: unknown[];
  const responseTimers = new Set<ReturnType<typeof setTimeout>>();

  const telemetry = {
    getLatestByDeviceId: async () => ({
      dissolvedOxygen: 5.2,
      ph: 7.7,
      temperature: 28.5,
      salinity: 15,
      turbidity: 20,
      // PredictionsService chụp mốc thời gian tham chiếu trước khi await fixture.
      // Giữ số đo test tổng hợp lùi nhẹ về quá khứ để race cùng mili-giây không
      // bị thể hiện sai thành telemetry timestamp tương lai trong production.
      recordedAt: new Date(Date.now() - SAFE_FIXTURE_TELEMETRY_AGE_MS),
    }),
  };

  beforeAll(async () => {
    const config = readIsolatedDatabaseConfig();
    if (!isLocalDatabaseHost(config.DB_HOST)) {
      throw new Error('AQS-101 acceptance only permits a local PostgreSQL fixture database.');
    }
    if (realFastApiUrl && !isLocalHttpUrl(realFastApiUrl)) {
      throw new Error('AQS-101 acceptance only permits an explicit local FastAPI URL.');
    }

    adminClient = new Client({
      host: config.DB_HOST,
      port: Number(config.DB_PORT || 5432),
      user: config.DB_USER,
      password: config.DB_PASS,
      database: 'postgres',
    });
    await adminClient.connect();

    const existing = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DATABASE]);
    if (existing.rowCount) {
      throw new Error(`Refusing to overwrite existing fixture database ${TEST_DATABASE}.`);
    }
    const role = await adminClient.query(
      'SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user',
    );
    if (role.rows[0]?.rolcreatedb !== true) {
      throw new Error('Current local PostgreSQL role cannot create an isolated fixture database.');
    }

    await adminClient.query(`CREATE DATABASE ${TEST_DATABASE}`);
    databaseCreated = true;
    dataSource = new DataSource({
      type: 'postgres',
      host: config.DB_HOST,
      port: Number(config.DB_PORT || 5432),
      username: config.DB_USER,
      password: config.DB_PASS,
      database: TEST_DATABASE,
      synchronize: true,
      entities: [
        User,
        UserSession,
        Farm,
        Pond,
        Device,
        ThresholdConfig,
        Alert,
        AiRecommendation,
        AiPrediction,
        ManualTestLog,
        PondFarmerAssignment,
        ShrimpBatch,
        HarvestLog,
        TelemetryData,
        TelemetryIngestReceipt,
        NotificationDelivery,
        NotificationToken,
        NotificationPreference,
      ],
    });
    await dataSource.initialize();

    const user = await dataSource.getRepository(User).save({
      fullName: 'AQS-101 Fixture Owner',
      phoneNumber: `aqs-${randomUUID().slice(0, 8)}`,
      email: null,
      gender: null,
      passwordHash: 'test-only-not-a-real-password',
      role: Role.ADMIN,
      fcmToken: null,
      isActive: true,
      isLocked: false,
      mustChangePassword: false,
      tokenVersion: 0,
    });
    pond = await dataSource.getRepository(Pond).save({
      userId: user.userId,
      farmId: null,
      pondName: `AQS-101 Fixture ${randomUUID().slice(0, 8)}`,
      location: null,
      capacity: null,
      areaM2: 100,
      depthM: 1.5,
      shrimpDensity: 80,
      status: PondStatus.ACTIVE,
    });

    fixtureServer = createServer((request, response) => {
      let rawBody = '';
      request.on('data', (chunk) => { rawBody += String(chunk); });
      request.on('end', () => {
        const responseFixture = fixtureResponse;
        receivedPayloads.push(JSON.parse(rawBody));
        const sendResponse = () => {
          response.writeHead(responseFixture.status, { 'content-type': 'application/json' });
          response.end(responseFixture.rawBody ?? JSON.stringify(responseFixture.body));
        };
        if (responseFixture.delayMs) {
          const timer = setTimeout(() => {
            responseTimers.delete(timer);
            sendResponse();
          }, responseFixture.delayMs);
          responseTimers.add(timer);
          return;
        }
        sendResponse();
      });
    });
    await new Promise<void>((resolve, reject) => {
      fixtureServer.once('error', reject);
      fixtureServer.listen(0, '127.0.0.1', resolve);
    });
    fixtureUrl = `http://127.0.0.1:${(fixtureServer.address() as AddressInfo).port}/api/predict`;
  });

  beforeEach(() => {
    receivedPayloads = [];
    fixtureResponse = {
      status: 200,
      body: { predictedDO: 4.8, predictedPH: 7.6, riskScore: 0, riskLevel: 'SAFE' },
    };
  });

  afterEach(() => {
    for (const timer of responseTimers) clearTimeout(timer);
    responseTimers.clear();
  });

  afterAll(async () => {
    for (const timer of responseTimers) clearTimeout(timer);
    responseTimers.clear();
    if (fixtureServer) {
      await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (databaseCreated) {
      await adminClient.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [TEST_DATABASE],
      );
      await adminClient.query(`DROP DATABASE ${TEST_DATABASE}`);
    }
    await adminClient?.end();
  });

  function createService(aiPredictionApiUrl = fixtureUrl): PredictionsService {
    const predictionRepo = dataSource.getRepository(AiPrediction);
    const realPondRepo = dataSource.getRepository(Pond);
    const pondRepo = {
      findOne: async ({ where }: { where: { pondId: string } }) => {
        const savedPond = await realPondRepo.findOne({ where });
        return savedPond ? { ...savedPond, devices: [{ deviceId: 'aqs101-device' }] } : null;
      },
    } as Repository<Pond>;
    return new PredictionsService(
      predictionRepo,
      pondRepo,
      new ConfigService({ AI_PREDICTION_API_URL: aiPredictionApiUrl }),
      telemetry as never,
    );
  }

  it.each([
    ['SAFE', 0, RiskLevel.LOW, 0],
    ['SAFE', 25, RiskLevel.LOW, 0.25],
    ['WARNING', 50, RiskLevel.MEDIUM, 0.5],
    ['DANGER', 75, RiskLevel.HIGH, 0.75],
    ['DANGER', 100, RiskLevel.HIGH, 1],
  ])('persists the test-only AI fixture %s/%i as %s/%f', async (riskLevel, riskScore, expectedLevel, expectedScore) => {
    fixtureResponse.body = { predictedDO: 4.8, predictedPH: 7.6, riskLevel, riskScore };
    const alertsBefore = await dataSource.getRepository(Alert).count();

    const result = await createService().predictForPond(pond.pondId);
    const persisted = await dataSource.getRepository(AiPrediction).findOneByOrFail({ predictionId: result.predictionId });

    expect(receivedPayloads).toHaveLength(1);
    expect(receivedPayloads[0]).toMatchObject({
      pondId: pond.pondId,
      currentDO: 5.2,
      currentPH: 7.7,
      currentTemp: 28.5,
      salinity: 15,
      turbidity: 20,
    });
    expect(persisted.riskLevel).toBe(expectedLevel);
    expect(persisted.riskScore).toBe(expectedScore);
    expect(persisted.isFallback).toBe(false);
    expect(persisted.predictionSource).toBe('AI_MICROSERVICE');
    expect(await dataSource.getRepository(Alert).count()).toBe(alertsBefore);
  });

  it.each([
    ['invalid enum', 200, { predictedDO: 4.8, predictedPH: 7.6, riskLevel: 'LOW', riskScore: 25 }],
    ['invalid score', 200, { predictedDO: 4.8, predictedPH: 7.6, riskLevel: 'SAFE', riskScore: 101 }],
    ['FastAPI validation response', 422, { detail: [] }],
    ['FastAPI approval gate', 503, { detail: { code: 'RISK_RULES_PENDING_APPROVAL' } }],
  ])('persists controlled HEURISTIC_RULE fallback for %s', async (_scenario, status, body) => {
    fixtureResponse = { status, body };

    const result = await createService().predictForPond(pond.pondId);
    const persisted = await dataSource.getRepository(AiPrediction).findOneByOrFail({ predictionId: result.predictionId });

    expect(persisted.isFallback).toBe(true);
    expect(persisted.predictionSource).toBe('HEURISTIC_RULE');
    expect(persisted.riskLevel).toMatch(/^(LOW|MEDIUM|HIGH)$/u);
    expect(persisted.riskScore).toBeGreaterThanOrEqual(0);
    expect(persisted.riskScore).toBeLessThanOrEqual(1);
  });

  it.each([
    ['negative score', { predictedDO: 4.8, predictedPH: 7.6, riskLevel: 'SAFE', riskScore: -1 }],
    ['invalid score type', { predictedDO: 4.8, predictedPH: 7.6, riskLevel: 'SAFE', riskScore: '25' }],
    ['missing predicted pH', { predictedDO: 4.8, riskLevel: 'SAFE', riskScore: 25 }],
  ])('persists controlled fallback for %s without raw AI attribution', async (_scenario, body) => {
    fixtureResponse = { status: 200, body };

    const result = await createService().predictForPond(pond.pondId);
    const persisted = await dataSource.getRepository(AiPrediction).findOneByOrFail({ predictionId: result.predictionId });

    expect(persisted.isFallback).toBe(true);
    expect(persisted.predictionSource).toBe('HEURISTIC_RULE');
  });

  it('persists controlled fallback for malformed FastAPI JSON', async () => {
    fixtureResponse = { status: 200, rawBody: '{"predictedDO":4.8' };

    const result = await createService().predictForPond(pond.pondId);
    const persisted = await dataSource.getRepository(AiPrediction).findOneByOrFail({ predictionId: result.predictionId });

    expect(persisted.isFallback).toBe(true);
    expect(persisted.predictionSource).toBe('HEURISTIC_RULE');
  });

  it('persists controlled fallback after a local connection refusal', async () => {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const refusedUrl = `http://127.0.0.1:${(reservation.address() as AddressInfo).port}/api/predict`;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));

    const result = await createService(refusedUrl).predictForPond(pond.pondId);
    const persisted = await dataSource.getRepository(AiPrediction).findOneByOrFail({ predictionId: result.predictionId });

    expect(persisted.isFallback).toBe(true);
    expect(persisted.predictionSource).toBe('HEURISTIC_RULE');
  });

  it('persists controlled fallback after the outbound request times out', async () => {
    fixtureResponse = {
      status: 200,
      body: { predictedDO: 4.8, predictedPH: 7.6, riskLevel: 'SAFE', riskScore: 25 },
      delayMs: 10_500,
    };

    const result = await createService().predictForPond(pond.pondId);
    const persisted = await dataSource.getRepository(AiPrediction).findOneByOrFail({ predictionId: result.predictionId });

    expect(persisted.isFallback).toBe(true);
    expect(persisted.predictionSource).toBe('HEURISTIC_RULE');
  }, 15_000);

  it.runIf(Boolean(realFastApiUrl))(
    'persists HEURISTIC_RULE fallback after the real FastAPI approval gate returns 503',
    async () => {
      const result = await createService(realFastApiUrl).predictForPond(pond.pondId);
      const persisted = await dataSource
        .getRepository(AiPrediction)
        .findOneByOrFail({ predictionId: result.predictionId });

      expect(persisted.isFallback).toBe(true);
      expect(persisted.predictionSource).toBe('HEURISTIC_RULE');
      expect(persisted.riskLevel).toMatch(/^(LOW|MEDIUM|HIGH)$/u);
      expect(persisted.riskScore).toBeGreaterThanOrEqual(0);
      expect(persisted.riskScore).toBeLessThanOrEqual(1);
    },
  );
});
