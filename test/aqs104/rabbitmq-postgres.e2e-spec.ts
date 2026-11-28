import { randomUUID } from 'node:crypto';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiRiskRabbitMqConsumer } from '../../src/modules/ai-risk-alerts/ai-risk-rabbitmq.consumer.js';
import { AiRiskAlertsService } from '../../src/modules/ai-risk-alerts/ai-risk-alerts.service.js';
import { AiRiskNotificationOutboxWorker } from '../../src/modules/ai-risk-alerts/ai-risk-notification-outbox.worker.js';
import { AiRiskAlertReceipt } from '../../src/modules/ai-risk-alerts/entities/ai-risk-alert-receipt.entity.js';
import { AiRiskNotificationOutbox } from '../../src/modules/ai-risk-alerts/entities/ai-risk-notification-outbox.entity.js';
import { validateAiRiskEvent } from '../../src/modules/ai-risk-alerts/ai-risk-event.validation.js';
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
    if (Date.now() >= deadline) throw new Error('Timed out waiting for AQS-104 E2E condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const riskEvent = (eventId = randomUUID(), riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'HIGH') => validateAiRiskEvent({
  event_id: eventId,
  event: 'ai.risk.detected',
  pond_id: FIXTURE_POND_ID,
  risk_level: riskLevel,
  predicted_metric: 'do_min',
  predicted_value: 2.8,
  action_suggestion: 'AQS-104 isolated E2E action',
  details: { source: 'aqs104-e2e' },
  timestamp: new Date().toISOString(),
}, 15);

e2eDescribe('AQS-104 real RabbitMQ + PostgreSQL', () => {
  let dataSource: DataSource;
  let service: AiRiskAlertsService;
  let publisherConnection: ChannelModel;
  let publisher: ConfirmChannel;
  let rabbitUrl: string;
  let exchange: string;
  const createdQueues: string[] = [];

  const databaseConfig = () => ({
    host: process.env.AQS104_E2E_DB_HOST,
    port: Number(process.env.AQS104_E2E_DB_PORT),
    username: process.env.AQS104_E2E_DB_USER,
    password: process.env.AQS104_E2E_DB_PASSWORD,
    database: process.env.AQS104_E2E_DB_NAME,
  });

  const consumerConfig = (queue: string) => new E2eConfig({
    RABBITMQ_URL: rabbitUrl,
    AI_RISK_ALERTS_CONSUMER_ENABLED: 'true',
    AI_PRODUCTION_INFERENCE_APPROVED: 'true',
    AI_RISK_ALERTS_QUEUE: queue,
    AI_RISK_ALERTS_DLQ: `${queue}.dlq`,
    AI_RISK_ALERTS_EXCHANGE: exchange,
    AI_RISK_ALERTS_MAX_RETRIES: '1',
    AI_RISK_ALERTS_MAX_AGE_MINUTES: '15',
    AI_RISK_ALERTS_PREFETCH: '1',
    AI_RISK_ALERTS_RECONNECT_DELAY_MS: '100',
    AI_RISK_ALERTS_PUBLISH_CONFIRM_TIMEOUT_MS: '2000',
  });

  const createQueueName = (): string => {
    const queue = `aqs104_e2e_${randomUUID().replaceAll('-', '')}`;
    createdQueues.push(queue);
    return queue;
  };

  const publish = async (payload: unknown): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      publisher.publish(exchange, 'ai.risk.detected', Buffer.from(JSON.stringify(payload)), { persistent: true, contentType: 'application/json' }, (error) => error ? reject(error) : resolve());
    });
  };

  const queueMessages = async (queue: string): Promise<number> => (await publisher.checkQueue(queue)).messageCount;

  beforeAll(async () => {
    rabbitUrl = process.env.AQS104_E2E_RABBITMQ_URL || '';
    expect(rabbitUrl).not.toBe('');
    expect(databaseConfig().host).toBeTruthy();
    // Never publish test events to the shared shrimp.events exchange: the
    // supplied fixture also binds ai_risk_alerts to ai.risk.#. The unit suite
    // verifies that production defaults remain shrimp.events; this real-broker
    // suite isolates only its exchange and queue names.
    exchange = `aqs104_e2e_exchange_${randomUUID().replaceAll('-', '')}`;
    dataSource = new DataSource({
      type: 'postgres',
      ...databaseConfig(),
      synchronize: false,
      entities: [
        AiRiskAlertReceipt, AiRiskNotificationOutbox, Alert, AiRecommendation,
        User, UserSession, Farm, Pond, Device, ThresholdConfig, ManualTestLog,
        PondFarmerAssignment, AiPrediction, ShrimpBatch, HarvestLog, TelemetryData,
        TelemetryIngestReceipt, NotificationDelivery, NotificationPreference, NotificationToken,
      ],
    });
    await dataSource.initialize();
    service = new AiRiskAlertsService(dataSource, consumerConfig('unused') as any);
    publisherConnection = await amqp.connect(rabbitUrl);
    publisher = await publisherConnection.createConfirmChannel();
    await publisher.assertExchange(exchange, 'topic', { durable: true });
  });

  afterAll(async () => {
    for (const queue of createdQueues) {
      if (!queue.startsWith('aqs104_e2e_')) continue;
      await publisher.deleteQueue(queue).catch(() => undefined);
      await publisher.deleteQueue(`${queue}.dlq`).catch(() => undefined);
    }
    await publisher.deleteExchange(exchange).catch(() => undefined);
    await publisher?.close().catch(() => undefined);
    await publisherConnection?.close().catch(() => undefined);
    await dataSource?.destroy().catch(() => undefined);
  });

  it('persists HIGH/MEDIUM/LOW correctly, including the durable outbox intent', async () => {
    const alertBefore = await dataSource.getRepository(Alert).count();
    const events = [riskEvent(undefined, 'HIGH'), riskEvent(undefined, 'MEDIUM'), riskEvent(undefined, 'LOW')];
    await expect(service.process(events[0])).resolves.toBe('CREATED');
    await expect(service.process(events[1])).resolves.toBe('CREATED');
    await expect(service.process(events[2])).resolves.toBe('IGNORED_LOW');
    expect(await dataSource.getRepository(Alert).count()).toBe(alertBefore + 2);
    expect(await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId: events[0].event_id })).toBe(1);
    expect(await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId: events[1].event_id })).toBe(1);
    expect(await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId: events[2].event_id })).toBe(1);
    expect(await dataSource.getRepository(AiRiskNotificationOutbox).count()).toBeGreaterThanOrEqual(2);
  });

  it('uses the PostgreSQL unique index as the concurrent duplicate barrier', async () => {
    const event = riskEvent();
    const alertBefore = await dataSource.getRepository(Alert).count();
    const results = await Promise.all([service.process(event), service.process(event)]);
    expect(results.sort()).toEqual(['CREATED', 'DUPLICATE']);
    expect(await dataSource.getRepository(Alert).count()).toBe(alertBefore + 1);
    expect(await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId: event.event_id })).toBe(1);
  });

  it('drains a persisted notification intent through a stubbed boundary without provider delivery', async () => {
    const event = riskEvent();
    await expect(service.process(event)).resolves.toBe('CREATED');
    const receipt = await dataSource.getRepository(AiRiskAlertReceipt).findOneByOrFail({ eventId: event.event_id });
    const intent = await dataSource.getRepository(AiRiskNotificationOutbox).findOneByOrFail({ alertId: receipt.alertId! });
    const dispatcher = { dispatchAlert: vi.fn().mockResolvedValue(undefined) };
    const alerts = { publishAlertTriggered: vi.fn().mockResolvedValue(undefined) };
    const worker = new AiRiskNotificationOutboxWorker(dataSource, alerts as any, dispatcher as any, service, consumerConfig('unused') as any);
    await (worker as any).dispatch(intent);
    expect(dispatcher.dispatchAlert).toHaveBeenCalledWith(expect.objectContaining({ alertId: receipt.alertId }));
    expect(alerts.publishAlertTriggered).toHaveBeenCalledWith(expect.objectContaining({ alertId: receipt.alertId }));
    expect((await dataSource.getRepository(AiRiskNotificationOutbox).findOneByOrFail({ outboxId: intent.outboxId })).status).toBe('DISPATCHED');
  });

  it('retries a transient RabbitMQ delivery once through the topic exchange and succeeds on attempt two', async () => {
    const queue = createQueueName();
    let attempts = 0;
    const transientService = { isEnabled: () => true, process: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('simulated PostgreSQL outage');
      return 'CREATED';
    } };
    const consumer = new AiRiskRabbitMqConsumer(consumerConfig(queue) as any, transientService as any);
    await consumer.start();
    try {
      await publish(riskEvent());
      await waitFor(() => attempts === 2);
      expect(await queueMessages(queue)).toBe(0);
      expect(await queueMessages(`${queue}.dlq`)).toBe(0);
    } finally {
      await consumer.onModuleDestroy();
    }
  });

  it('sends exhausted and invalid events to the isolated DLQ without touching baseline messages', async () => {
    const queue = createQueueName();
    let attempts = 0;
    const failingService = { isEnabled: () => true, process: async () => { attempts += 1; throw new Error('simulated PostgreSQL outage'); } };
    const consumer = new AiRiskRabbitMqConsumer(consumerConfig(queue) as any, failingService as any);
    await consumer.start();
    try {
      await publish(riskEvent());
      await waitFor(async () => (await queueMessages(`${queue}.dlq`)) === 1);
      expect(attempts).toBe(2);
      await publish({ event: 'ai.risk.detected', event_id: 'invalid' });
      await waitFor(async () => (await queueMessages(`${queue}.dlq`)) === 2);
      expect(await queueMessages(queue)).toBe(0);
    } finally {
      await consumer.onModuleDestroy();
    }
  });

  it('reconnects after a RabbitMQ connection close and continues consuming', async () => {
    const queue = createQueueName();
    let attempts = 0;
    const countingService = { isEnabled: () => true, process: async () => { attempts += 1; return 'CREATED'; } };
    const consumer = new AiRiskRabbitMqConsumer(consumerConfig(queue) as any, countingService as any);
    await consumer.start();
    const initialConnection = (consumer as any).connection as ChannelModel;
    try {
      await initialConnection.close();
      await waitFor(() => (consumer as any).connection && (consumer as any).connection !== initialConnection);
      await publish(riskEvent());
      await waitFor(() => attempts === 1);
    } finally {
      await consumer.onModuleDestroy();
    }
  });

  it('redelivers after an ACK-side crash without creating a duplicate PostgreSQL Alert', async () => {
    const queue = createQueueName();
    const event = riskEvent();
    const alertBefore = await dataSource.getRepository(Alert).count();
    const first = new AiRiskRabbitMqConsumer(consumerConfig(queue) as any, service);
    await first.start();
    const firstChannel = (first as any).channel as ConfirmChannel;
    const originalAck = firstChannel.ack.bind(firstChannel);
    (firstChannel as any).ack = () => { throw new Error('simulated process crash before ACK'); };
    try {
      await publish(event);
      await waitFor(async () => (await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId: event.event_id })) === 1);
      await first.onModuleDestroy();
      const restarted = new AiRiskRabbitMqConsumer(consumerConfig(queue) as any, service);
      await restarted.start();
      try {
        await waitFor(async () => (await queueMessages(queue)) === 0);
        expect(await dataSource.getRepository(Alert).count()).toBe(alertBefore + 1);
        expect(await dataSource.getRepository(AiRiskAlertReceipt).countBy({ eventId: event.event_id })).toBe(1);
      } finally {
        await restarted.onModuleDestroy();
      }
    } finally {
      (firstChannel as any).ack = originalAck;
    }
  });
});
