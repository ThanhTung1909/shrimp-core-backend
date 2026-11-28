/* Dedicated, disposable AQS-104 frontend-auth fixture. Never targets a shared DB. */
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { User } from '../../dist/modules/users/entities/user.entity.js';
import { UserSession } from '../../dist/modules/auth/entities/user-session.entity.js';
import { Farm } from '../../dist/modules/farms/entities/farm.entity.js';
import { Pond } from '../../dist/modules/ponds/entities/pond.entity.js';
import { PondFarmerAssignment } from '../../dist/modules/ponds/entities/pond-farmer-assignment.entity.js';
import { Device } from '../../dist/modules/devices/entities/device.entity.js';
import { ThresholdConfig } from '../../dist/modules/ponds/entities/threshold-config.entity.js';
import { ManualTestLog } from '../../dist/modules/ponds/entities/manual-test-log.entity.js';
import { TelemetryData } from '../../dist/modules/telemetry/entities/telemetry-data.entity.js';
import { TelemetryIngestReceipt } from '../../dist/modules/telemetry/entities/telemetry-ingest-receipt.entity.js';
import { AiPrediction } from '../../dist/modules/predictions/entities/ai-prediction.entity.js';
import { ShrimpBatch } from '../../dist/modules/crops/entities/shrimp-batch.entity.js';
import { HarvestLog } from '../../dist/modules/crops/entities/harvest-log.entity.js';
import { Alert } from '../../dist/modules/alerts/entities/alert.entity.js';
import { AiRecommendation } from '../../dist/modules/alerts/entities/ai-recommendation.entity.js';
import { NotificationDelivery } from '../../dist/modules/notifications/entities/notification-delivery.entity.js';
import { NotificationPreference } from '../../dist/modules/notifications/entities/notification-preference.entity.js';
import { NotificationToken } from '../../dist/modules/notifications/entities/notification-token.entity.js';
import { AiRiskAlertReceipt } from '../../dist/modules/ai-risk-alerts/entities/ai-risk-alert-receipt.entity.js';
import { AiRiskNotificationOutbox } from '../../dist/modules/ai-risk-alerts/entities/ai-risk-notification-outbox.entity.js';
import { AiRiskAlertsService } from '../../dist/modules/ai-risk-alerts/ai-risk-alerts.service.js';
import { validateAiRiskEvent } from '../../dist/modules/ai-risk-alerts/ai-risk-event.validation.js';

const required = [
  'AQS104_FE_DB_HOST',
  'AQS104_FE_DB_PORT',
  'AQS104_FE_DB_USER',
  'AQS104_FE_DB_PASSWORD',
  'AQS104_FE_DB_NAME',
  'AQS104_FE_PASSWORD',
  'AQS104_FE_FIXTURE_PATH',
];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
if (
  process.env.AQS104_FE_DB_NAME !== 'aqs104_frontend_e2e' ||
  !['127.0.0.1', 'localhost'].includes(process.env.AQS104_FE_DB_HOST || '') ||
  process.env.AQS104_FE_DB_PORT !== '56304'
) {
  throw new Error('AQS-104: refusing to seed outside the isolated frontend E2E database');
}
if (process.env.AQS104_FE_ALLOW_SCHEMA_SYNC !== 'true') {
  throw new Error('AQS-104: schema synchronization requires explicit isolated-fixture consent');
}

const fixtureDirectory = resolve('tmp');
const fixturePath = resolve(process.env.AQS104_FE_FIXTURE_PATH);
const fixturePathRelativeToTmp = relative(fixtureDirectory, fixturePath);
if (
  fixturePathRelativeToTmp === '' ||
  fixturePathRelativeToTmp.startsWith('..') ||
  isAbsolute(fixturePathRelativeToTmp)
) {
  throw new Error('AQS-104: fixture manifest must remain under the ignored tmp directory');
}


const dataSource = new DataSource({
  type: 'postgres', host: process.env.AQS104_FE_DB_HOST, port: Number(process.env.AQS104_FE_DB_PORT),
  username: process.env.AQS104_FE_DB_USER, password: process.env.AQS104_FE_DB_PASSWORD,
  database: process.env.AQS104_FE_DB_NAME, synchronize: true,
  entities: [User, UserSession, Farm, Pond, PondFarmerAssignment, Device, ThresholdConfig, ManualTestLog,
    TelemetryData, TelemetryIngestReceipt, AiPrediction, ShrimpBatch, HarvestLog, Alert, AiRecommendation,
    NotificationDelivery, NotificationPreference, NotificationToken, AiRiskAlertReceipt, AiRiskNotificationOutbox],
});

const fixturePassword = process.env.AQS104_FE_PASSWORD;
const config = { get: (key) => ({
  AI_RISK_ALERTS_CONSUMER_ENABLED: 'true', AI_PRODUCTION_INFERENCE_APPROVED: 'true',
}[key]) };

const createUser = async (role, phone, name, active = true) => dataSource.getRepository(User).save({
  fullName: name, phoneNumber: phone, email: `${phone}@aqs104.fixture.invalid`,
  passwordHash: await bcrypt.hash(fixturePassword, 10), role, isActive: active,
  isLocked: false, mustChangePassword: false, tokenVersion: 0,
});

await dataSource.initialize();
try {
  const admin = await createUser('ADMIN', '0900000101', 'AQS104 TEST_ONLY Admin');
  const managerA = await createUser('MANAGER', '0900000102', 'AQS104 TEST_ONLY Manager A');
  const managerB = await createUser('MANAGER', '0900000103', 'AQS104 TEST_ONLY Manager B');
  const farmerA = await createUser('FARMER', '0900000104', 'AQS104 TEST_ONLY Farmer A');
  await createUser('FARMER', '0900000105', 'AQS104 TEST_ONLY Inactive', false);
  const farmA = await dataSource.getRepository(Farm).save({ farmName: 'AQS104 TEST_ONLY Farm A', ownerId: managerA.userId, address: 'TEST_ONLY' });
  const farmB = await dataSource.getRepository(Farm).save({ farmName: 'AQS104 TEST_ONLY Farm B', ownerId: managerB.userId, address: 'TEST_ONLY' });
  const pondA = await dataSource.getRepository(Pond).save({ userId: managerA.userId, farmId: farmA.farmId, pondName: 'AQS104 TEST_ONLY Pond A', areaM2: 100, depthM: 1.5, shrimpDensity: 100, status: 'ACTIVE' });
  const pondB = await dataSource.getRepository(Pond).save({ userId: managerB.userId, farmId: farmB.farmId, pondName: 'AQS104 TEST_ONLY Pond B', areaM2: 120, depthM: 1.5, shrimpDensity: 100, status: 'ACTIVE' });
  await dataSource.getRepository(PondFarmerAssignment).save({ pondId: pondA.pondId, farmerId: farmerA.userId });
  const service = new AiRiskAlertsService(dataSource, config);
  const event = (pondId, riskLevel, metric, value) => validateAiRiskEvent({
    event_id: crypto.randomUUID(), event: 'ai.risk.detected', pond_id: pondId, risk_level: riskLevel,
    predicted_metric: metric, predicted_value: value,
    action_suggestion: 'AQS-104 TEST_ONLY browser fixture; not an ML prediction.',
    details: { test_only: true, source: 'aqs104-frontend-e2e' }, timestamp: new Date().toISOString(),
  }, 15);
  await service.process(event(pondA.pondId, 'HIGH', 'dissolved_oxygen', 2.8));
  await service.process(event(pondA.pondId, 'MEDIUM', 'do_min', 3.6));
  await service.process(event(pondA.pondId, 'LOW', 'do_min', 5.5));
  await service.process(event(pondB.pondId, 'HIGH', 'dissolved_oxygen', 2.7));
  const fixture = {
    adminPhone: admin.phoneNumber, managerAPhone: managerA.phoneNumber, farmerAPhone: farmerA.phoneNumber,
    inactivePhone: '0900000105', pondA: pondA.pondId, pondB: pondB.pondId,
  };
  writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  process.stdout.write('AQS104 frontend auth fixture seeded\n');
} finally {
  await dataSource.destroy();
}
