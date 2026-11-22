/* Adds the related AI-prediction record to the disposable frontend fixture. */
import { DataSource } from 'typeorm';
import { AiPrediction } from '../../dist/modules/predictions/entities/ai-prediction.entity.js';
import { Pond } from '../../dist/modules/ponds/entities/pond.entity.js';
import { User } from '../../dist/modules/users/entities/user.entity.js';
import { UserSession } from '../../dist/modules/auth/entities/user-session.entity.js';
import { Farm } from '../../dist/modules/farms/entities/farm.entity.js';
import { PondFarmerAssignment } from '../../dist/modules/ponds/entities/pond-farmer-assignment.entity.js';
import { Device } from '../../dist/modules/devices/entities/device.entity.js';
import { ThresholdConfig } from '../../dist/modules/ponds/entities/threshold-config.entity.js';
import { ManualTestLog } from '../../dist/modules/ponds/entities/manual-test-log.entity.js';
import { TelemetryData } from '../../dist/modules/telemetry/entities/telemetry-data.entity.js';
import { TelemetryIngestReceipt } from '../../dist/modules/telemetry/entities/telemetry-ingest-receipt.entity.js';
import { ShrimpBatch } from '../../dist/modules/crops/entities/shrimp-batch.entity.js';
import { HarvestLog } from '../../dist/modules/crops/entities/harvest-log.entity.js';
import { Alert } from '../../dist/modules/alerts/entities/alert.entity.js';
import { AiRecommendation } from '../../dist/modules/alerts/entities/ai-recommendation.entity.js';
import { NotificationDelivery } from '../../dist/modules/notifications/entities/notification-delivery.entity.js';
import { NotificationPreference } from '../../dist/modules/notifications/entities/notification-preference.entity.js';
import { NotificationToken } from '../../dist/modules/notifications/entities/notification-token.entity.js';
import { AiRiskAlertReceipt } from '../../dist/modules/ai-risk-alerts/entities/ai-risk-alert-receipt.entity.js';
import { AiRiskNotificationOutbox } from '../../dist/modules/ai-risk-alerts/entities/ai-risk-notification-outbox.entity.js';

const required = ['AQS104_FE_DB_HOST', 'AQS104_FE_DB_PORT', 'AQS104_FE_DB_USER', 'AQS104_FE_DB_PASSWORD', 'AQS104_FE_DB_NAME'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
if (
  process.env.AQS104_FE_DB_NAME !== 'aqs104_frontend_e2e' ||
  !['127.0.0.1', 'localhost'].includes(process.env.AQS104_FE_DB_HOST || '') ||
  process.env.AQS104_FE_DB_PORT !== '56304'
) {
  throw new Error('AQS-104: refusing to seed outside the isolated frontend E2E database');
}


const dataSource = new DataSource({
  type: 'postgres', host: process.env.AQS104_FE_DB_HOST, port: Number(process.env.AQS104_FE_DB_PORT),
  username: process.env.AQS104_FE_DB_USER, password: process.env.AQS104_FE_DB_PASSWORD,
  database: process.env.AQS104_FE_DB_NAME,
  entities: [User, UserSession, Farm, Pond, PondFarmerAssignment, Device, ThresholdConfig, ManualTestLog,
    TelemetryData, TelemetryIngestReceipt, AiPrediction, ShrimpBatch, HarvestLog, Alert, AiRecommendation,
    NotificationDelivery, NotificationPreference, NotificationToken, AiRiskAlertReceipt, AiRiskNotificationOutbox],
});

await dataSource.initialize();
try {
  const pond = await dataSource.getRepository(Pond).findOneByOrFail({ pondName: 'AQS104 TEST_ONLY Pond A' });
  const repo = dataSource.getRepository(AiPrediction);
  if (!await repo.exist({ where: { pondId: pond.pondId } })) {
    await repo.save({
      pondId: pond.pondId, predictedTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      predictedDO: 2.8, predictedPH: 7.2, riskScore: 0.9, riskLevel: 'HIGH',
      isFallback: true, predictionSource: 'AQS104_TEST_FIXTURE',
    });
  }
  process.stdout.write('AQS104 frontend prediction fixture seeded\n');
} finally {
  await dataSource.destroy();
}
