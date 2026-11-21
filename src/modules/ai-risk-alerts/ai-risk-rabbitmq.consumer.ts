import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { AiRiskAlertsService } from './ai-risk-alerts.service.js';
import { validateAiRiskEvent } from './ai-risk-event.validation.js';

@Injectable()
export class AiRiskRabbitMqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiRiskRabbitMqConsumer.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(private readonly config: ConfigService, private readonly service: AiRiskAlertsService) {}

  async onModuleInit(): Promise<void> {
    if (!this.service.isEnabled()) {
      this.logger.log('[AI Risk Consumer] Disabled: approval and explicit consumer flag are both required.');
      return;
    }
    try { await this.start(); } catch (error) { this.logger.error('[AI Risk Consumer] Initial connection failed; service continues without consumer.', error instanceof Error ? error.stack : String(error)); }
  }

  private queue(): string { return this.config.get<string>('AI_RISK_ALERTS_QUEUE') || 'ai_risk_alerts'; }
  private dlq(): string { return this.config.get<string>('AI_RISK_ALERTS_DLQ') || `${this.queue()}.dlq`; }

  async start(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) throw new Error('RABBITMQ_URL is required when AI risk consumer is enabled');
    const connection = await amqp.connect(url, { timeout: Number(this.config.get<string>('AI_RISK_ALERTS_CONNECT_TIMEOUT_MS') || 5000) });
    const channel = await connection.createChannel();
    this.connection = connection;
    this.channel = channel;
    const exchange = this.config.get<string>('AI_RISK_ALERTS_EXCHANGE') || 'shrimp.events';
    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertQueue(this.queue(), { durable: true });
    await channel.bindQueue(this.queue(), exchange, 'ai.risk.#');
    await channel.assertQueue(this.dlq(), { durable: true });
    await channel.prefetch(Math.max(1, Number(this.config.get<string>('AI_RISK_ALERTS_PREFETCH') || 10)));
    await channel.consume(this.queue(), (message) => void this.handle(message), { noAck: false });
    this.logger.log('[AI Risk Consumer] Connected and consuming AI risk events.');
  }

  async handle(message: ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) return;
    try {
      if (message.fields.routingKey !== 'ai.risk.detected') throw new PermanentAiRiskEventError('Unexpected routing key');
      if (message.content.length > 8192) throw new PermanentAiRiskEventError('Message too large');
      let payload: unknown;
      try { payload = JSON.parse(message.content.toString('utf8')); } catch { throw new PermanentAiRiskEventError('Malformed JSON'); }
      const event = validateAiRiskEvent(payload, Number(this.config.get<string>('AI_RISK_ALERTS_MAX_AGE_MINUTES') || 15));
      const result = await this.service.process(event);
      if (result === 'POND_NOT_FOUND') throw new PermanentAiRiskEventError('Pond not found');
      this.channel.ack(message);
    } catch (error) {
      if (error instanceof PermanentAiRiskEventError) {
        try {
          this.channel.sendToQueue(this.dlq(), message.content, { persistent: true, headers: { ...message.properties.headers, 'x-ai-risk-error': error.message } });
          this.channel.ack(message);
        } catch { this.channel.nack(message, false, true); }
        return;
      }
      await this.retryOrDlq(message);
    }
  }

  private async retryOrDlq(message: ConsumeMessage): Promise<void> {
    if (!this.channel) return;
    const retries = Number(message.properties.headers?.['x-ai-risk-retry'] || 0);
    const maxRetries = Math.max(0, Number(this.config.get<string>('AI_RISK_ALERTS_MAX_RETRIES') || 3));
    if (retries < maxRetries) {
      this.channel.sendToQueue(this.queue(), message.content, { persistent: true, headers: { ...message.properties.headers, 'x-ai-risk-retry': retries + 1 } });
      this.channel.ack(message);
      return;
    }
    this.channel.sendToQueue(this.dlq(), message.content, { persistent: true, headers: { ...message.properties.headers, 'x-ai-risk-error': 'transient retry exhausted' } });
    this.channel.ack(message);
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = null;
    this.connection = null;
  }
}

class PermanentAiRiskEventError extends Error {}
