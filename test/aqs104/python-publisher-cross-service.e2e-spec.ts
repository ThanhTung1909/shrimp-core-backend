import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiRiskRabbitMqConsumer } from '../../src/modules/ai-risk-alerts/ai-risk-rabbitmq.consumer.js';
import { AiRiskAlertsService } from '../../src/modules/ai-risk-alerts/ai-risk-alerts.service.js';
import { AiRiskAlertReceipt } from '../../src/modules/ai-risk-alerts/entities/ai-risk-alert-receipt.entity.js';
import { AiRiskNotificationOutbox } from '../../src/modules/ai-risk-alerts/entities/ai-risk-notification-outbox.entity.js';
import { Alert } from '../../src/modules/alerts/entities/alert.entity.js';
import { AiRecommendation } from '../../src/modules/alerts/entities/ai-recommendation.entity.js';
import { UserSession } from '../../src/modules/auth/entities/user-session.entity.js';
import { ShrimpBatch } from '../../src/modules/crops/entities/shrimp-batch.entity.js';
import { HarvestLog } from '../../src/modules/crops/entities/harvest-log.entity.js';
import { Device } from '../../src/modules/devices/entities/device.entity.js';
import { Farm } from '../../src/modules/farms/entities/farm.entity.js';
import { NotificationDelivery } from '../../src/modules/notifications/entities/notification-delivery.entity.js';
import { NotificationPreference } from '../../src/modules/notifications/entities/notification-preference.entity.js';
import { NotificationToken } from '../../src/modules/notifications/entities/notification-token.entity.js';
import { ManualTestLog } from '../../src/modules/ponds/entities/manual-test-log.entity.js';
import { PondFarmerAssignment } from '../../src/modules/ponds/entities/pond-farmer-assignment.entity.js';
import { Pond } from '../../src/modules/ponds/entities/pond.entity.js';
import { ThresholdConfig } from '../../src/modules/ponds/entities/threshold-config.entity.js';
import { AiPrediction } from '../../src/modules/predictions/entities/ai-prediction.entity.js';
import { TelemetryData } from '../../src/modules/telemetry/entities/telemetry-data.entity.js';
import { TelemetryIngestReceipt } from '../../src/modules/telemetry/entities/telemetry-ingest-receipt.entity.js';
import { User } from '../../src/modules/users/entities/user.entity.js';

const FIXTURE_POND_ID = '878b6ccb-1432-42af-b4e1-27151b87ec12';
const enabled = process.env.AQS104_E2E === 'true';
const e2eDescribe = enabled ? describe : describe.skip;

class E2eConfig {
  constructor(private readonly values: Record<string, string>) {}
  get<T extends string>(key: string): T | undefined { return this.values[key] as T | undefined; }
}

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 8_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for cross-service AQS-104 condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const runPythonPublisher = async (eventId: string, exchange: string, queue: string): Promise<boolean> => {
  const python = process.env.AQS104_AI_PYTHON;
  const worktree = process.env.AQS104_AI_WORKTREE;
  const rabbitUrl = process.env.AQS104_E2E_RABBITMQ_URL;
  if (!python || !worktree || !rabbitUrl) throw new Error('AQS-104 Python E2E environment is incomplete');
  const parsed = new URL(rabbitUrl);
  const source = [
    'import asyncio, json, os',
    'from app.services.rabbitmq_publisher import RabbitMQPublisher',
    'async def main():',
    "    publisher = RabbitMQPublisher(exchange_name=os.environ['AQS104_EXCHANGE'], queue_name=os.environ['AQS104_QUEUE'])",
    "    ok = await publisher.publish_risk_alert(pond_id=os.environ['AQS104_EVENT_ID'] and '878b6ccb-1432-42af-b4e1-27151b87ec12', risk_level='HIGH', metric='dissolved_oxygen', predicted_value=2.8, action_suggestion='AQS-104 cross-service test event; not an ML prediction.', details={'test_only': True, 'source': 'aqs104-cross-service-e2e'}, event_id=os.environ['AQS104_EVENT_ID'])",
    '    await publisher.close()',
    "    print(json.dumps({'published': ok}))",
    'asyncio.run(main())',
  ].join('\n');
  const env = {
    ...process.env,
    APP_ENV: 'test', APP_PORT: '8000', DB_PORT: '5432', REDIS_PORT: '6379',
    RABBITMQ_HOST: parsed.hostname,
    RABBITMQ_PORT: parsed.port || '5672',
    RABBITMQ_USER: decodeURIComponent(parsed.username),
    RABBITMQ_PASS: decodeURIComponent(parsed.password),
    AQS104_EVENT_ID: eventId, AQS104_EXCHANGE: exchange, AQS104_QUEUE: queue,
  };
  return new Promise<boolean>((resolve, reject) => {
    let output = '';
    const child = spawn(python, ['-c', source], { cwd: worktree, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', () => reject(new Error('Unable to start the configured Python publisher')));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Python publisher exited with code ${code}`));
      resolve(output.includes('"published": true'));
    });
  });
};

e2eDescribe('AQS-104 Python publisher cross-service delivery', () => {
  let dataSource: DataSource;
  let service: AiRiskAlertsService;
  let connection: ChannelModel;
  let channel: ConfirmChannel;
  let consumer: AiRiskRabbitMqConsumer;
  let exchange: string;
  let queue: string;
  let originalQueueCounts: { main: number; dlq: number };

  const databaseConfig = () => ({
    host: process.env.AQS104_E2E_DB_HOST,
    port: Number(process.env.AQS104_E2E_DB_PORT),
    username: process.env.AQS104_E2E_DB_USER,
    password: process.env.AQS104_E2E_DB_PASSWORD,
    database: process.env.AQS104_E2E_DB_NAME,
  });
  const consumerConfig = () => new E2eConfig({
    RABBITMQ_URL: process.env.AQS104_E2E_RABBITMQ_URL || '',
    AI_RISK_ALERTS_CONSUMER_ENABLED: 'true', AI_PRODUCTION_INFERENCE_APPROVED: 'true',
    AI_RISK_ALERTS_QUEUE: queue, AI_RISK_ALERTS_DLQ: `${queue}.dlq`, AI_RISK_ALERTS_EXCHANGE: exchange,
    AI_RISK_ALERTS_MAX_RETRIES: '1', AI_RISK_ALERTS_MAX_AGE_MINUTES: '15',
    AI_RISK_ALERTS_PREFETCH: '1', AI_RISK_ALERTS_RECONNECT_DELAY_MS: '100',
    AI_RISK_ALERTS_PUBLISH_CONFIRM_TIMEOUT_MS: '2000',
  });

  beforeAll(async () => {
    expect(process.env.AQS104_E2E_RABBITMQ_URL).toBeTruthy();
    expect(databaseConfig().host).toBeTruthy();
    exchange = `aqs104_cross_service_exchange_${randomUUID().replaceAll('-', '')}`;
    queue = `aqs104_cross_service_${randomUUID().replaceAll('-', '')}`;
    dataSource = new DataSource({
      type: 'postgres', ...databaseConfig(), synchronize: false,
      entities: [AiRiskAlertReceipt, AiRiskNotificationOutbox, Alert, AiRecommendation, User, UserSession,
        Farm, Pond, Device, ThresholdConfig, ManualTestLog, PondFarmerAssignment, AiPrediction, ShrimpBatch,
        HarvestLog, TelemetryData, TelemetryIngestReceipt, NotificationDelivery, NotificationPreference, NotificationToken],
    });
    await dataSource.initialize();
    service = new AiRiskAlertsService(dataSource, consumerConfig() as any);
    connection = await amqp.connect(process.env.AQS104_E2E_RABBITMQ_URL!);
    channel = await connection.createConfirmChannel();
    originalQueueCounts = {
      main: (await channel.checkQueue('ai_risk_alerts')).messageCount,
      dlq: (await channel.checkQueue('ai_risk_alerts.dlq')).messageCount,
    };
    consumer = new AiRiskRabbitMqConsumer(consumerConfig() as any, service);
    await consumer.start();
  });

  afterAll(async () => {
    await consumer?.onModuleDestroy().catch(() => undefined);
    // These UUID names are created exclusively by this spec; cleanup never targets shared queues.
    if (queue?.startsWith('aqs104_cross_service_')) {
      await channel?.deleteQueue(queue).catch(() => undefined);
      await channel?.deleteQueue(`${queue}.dlq`).catch(() => undefined);
    }
    if (exchange?.startsWith('aqs104_cross_service_exchange_')) await channel?.deleteExchange(exchange).catch(() => undefined);
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    await dataSource?.destroy().catch(() => undefined);
  });

  it('publishes from FastAPI code and persists one idempotent alert with an outbox intent', async () => {
    const eventId = randomUUID();
    expect(await runPythonPublisher(eventId, exchange, queue)).toBe(true);
    await waitFor(async () => (await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId })) === 1);

    const receipt = await dataSource.getRepository(AiRiskAlertReceipt).findOneByOrFail({ eventId });
    expect(receipt.outcome).toBe('CREATED');
    expect(receipt.alertId).toBeTruthy();
    const alert = await dataSource.getRepository(Alert).findOneByOrFail({ alertId: receipt.alertId! });
    expect(alert.pondId).toBe(FIXTURE_POND_ID);
    expect(alert.alertLevel).toBe('CRITICAL');
    expect(await dataSource.getRepository(Alert).countBy({ alertId: alert.alertId })).toBe(1);
    expect(await dataSource.getRepository(AiRiskNotificationOutbox).countBy({ alertId: alert.alertId })).toBe(1);
    await waitFor(async () => (await channel.checkQueue(queue)).messageCount === 0);

    // A retry reuses the same business event ID and must be ACKed as a duplicate.
    expect(await runPythonPublisher(eventId, exchange, queue)).toBe(true);
    await waitFor(async () => (await channel.checkQueue(queue)).messageCount === 0);
    expect(await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId })).toBe(1);
    expect(await dataSource.getRepository(Alert).countBy({ alertId: alert.alertId })).toBe(1);
    expect(await dataSource.getRepository(AiRiskNotificationOutbox).countBy({ alertId: alert.alertId })).toBe(1);
    expect((await channel.checkQueue(`${queue}.dlq`)).messageCount).toBe(0);
    expect((await channel.checkQueue('ai_risk_alerts')).messageCount).toBe(originalQueueCounts.main);
    expect((await channel.checkQueue('ai_risk_alerts.dlq')).messageCount).toBe(originalQueueCounts.dlq);
  });
});
