import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage, type Message, type Options } from 'amqplib';
import { AiRiskAlertsService } from './ai-risk-alerts.service.js';
import { validateAiRiskEvent } from './ai-risk-event.validation.js';

const RISK_ROUTING_KEY = 'ai.risk.detected';
const PUBLISH_ID_HEADER = 'x-aqs104-publish-id';

@Injectable()
export class AiRiskRabbitMqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiRiskRabbitMqConsumer.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private connecting = false;
  private readonly pendingMandatoryReturns = new Map<string, (error: Error) => void>();

  constructor(private readonly config: ConfigService, private readonly service: AiRiskAlertsService) {}

  async onModuleInit(): Promise<void> {
    if (!this.service.isEnabled()) {
      this.logger.log('[AI Risk Consumer] Disabled: approval and explicit consumer flag are both required.');
      return;
    }
    await this.start().catch(() => {
      this.logger.error('[AI Risk Consumer] Initial connection failed; service continues and will retry in the background.');
      this.scheduleReconnect();
    });
  }

  private queue(): string { return this.config.get<string>('AI_RISK_ALERTS_QUEUE') || 'ai_risk_alerts'; }
  private dlq(): string { return this.config.get<string>('AI_RISK_ALERTS_DLQ') || `${this.queue()}.dlq`; }
  private exchange(): string { return this.config.get<string>('AI_RISK_ALERTS_EXCHANGE') || 'shrimp.events'; }
  private maxRetries(): number { return Math.max(0, Number(this.config.get<string>('AI_RISK_ALERTS_MAX_RETRIES') || 3)); }
  private reconnectDelayMs(): number { return Math.max(250, Number(this.config.get<string>('AI_RISK_ALERTS_RECONNECT_DELAY_MS') || 5_000)); }
  private publishConfirmTimeoutMs(): number { return Math.max(100, Number(this.config.get<string>('AI_RISK_ALERTS_PUBLISH_CONFIRM_TIMEOUT_MS') || 5_000)); }

  async start(): Promise<void> {
    if (this.stopping || !this.service.isEnabled() || this.connection || this.connecting) return;
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) throw new Error('RABBITMQ_URL is required when AI risk consumer is enabled');
    this.connecting = true;
    let connection: ChannelModel | null = null;
    let channel: ConfirmChannel | null = null;
    try {
      connection = await amqp.connect(url, { timeout: Number(this.config.get<string>('AI_RISK_ALERTS_CONNECT_TIMEOUT_MS') || 5_000) });
      channel = await connection.createConfirmChannel();
      await channel.assertExchange(this.exchange(), 'topic', { durable: true });
      await channel.assertQueue(this.queue(), { durable: true });
      await channel.bindQueue(this.queue(), this.exchange(), 'ai.risk.#');
      await channel.assertQueue(this.dlq(), { durable: true });
      await channel.prefetch(Math.max(1, Number(this.config.get<string>('AI_RISK_ALERTS_PREFETCH') || 10)));
      channel.on('return', (message) => this.handleMandatoryReturn(message));
      channel.on('error', () => this.logger.warn('[AI Risk Consumer] AMQP channel error; awaiting reconnect.'));
      channel.on('close', () => this.handleConnectionClosed(connection!));
      connection.on('error', () => this.logger.warn('[AI Risk Consumer] AMQP connection error; awaiting reconnect.'));
      connection.on('close', () => this.handleConnectionClosed(connection!));
      this.connection = connection;
      this.channel = channel;
      await channel.consume(this.queue(), (message) => void this.handle(message, channel!), { noAck: false });
      this.logger.log('[AI Risk Consumer] Connected with publisher confirms and consuming AI risk events.');
    } catch (error) {
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private handleConnectionClosed(connection: ChannelModel): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.channel = null;
    if (!this.stopping) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || !this.service.isEnabled() || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch(() => {
        this.logger.error('[AI Risk Consumer] Reconnect attempt failed; keeping Core available and retrying.');
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs());
  }

  async handle(message: ConsumeMessage | null, channel: ConfirmChannel | null = this.channel): Promise<void> {
    if (!message || !channel) return;
    try {
      if (message.fields.routingKey !== RISK_ROUTING_KEY) throw new PermanentAiRiskEventError('Unexpected routing key');
      if (message.content.length > 8_192) throw new PermanentAiRiskEventError('Message too large');
      let payload: unknown;
      try { payload = JSON.parse(message.content.toString('utf8')); } catch { throw new PermanentAiRiskEventError('Malformed JSON'); }
      let event;
      try {
        event = validateAiRiskEvent(payload, Number(this.config.get<string>('AI_RISK_ALERTS_MAX_AGE_MINUTES') || 15));
      } catch (error) {
        throw new PermanentAiRiskEventError(error instanceof Error ? error.message : 'Invalid AI risk event');
      }
      const result = await this.service.process(event);
      if (result === 'POND_NOT_FOUND') throw new PermanentAiRiskEventError('Pond not found');
      this.ack(channel, message);
    } catch (error) {
      if (error instanceof PermanentAiRiskEventError) {
        await this.handoffToDlq(channel, message, error.message);
        return;
      }
      await this.retryOrDlq(channel, message);
    }
  }

  private async retryOrDlq(channel: ConfirmChannel, message: ConsumeMessage): Promise<void> {
    const retries = this.retryCount(message);
    try {
      if (retries < this.maxRetries()) {
        // Publish through the original topic exchange. sendToQueue() would use
        // the default exchange and rewrite the delivery routing key to the
        // queue name, causing the second attempt to be rejected as malformed.
        await this.publishConfirmed(channel, this.exchange(), RISK_ROUTING_KEY, message, {
          ...message.properties.headers,
          'x-ai-risk-retry': retries + 1,
        });
      } else {
        await this.publishToDlqConfirmed(channel, message, 'transient retry exhausted');
      }
      this.ack(channel, message);
    } catch {
      // The original delivery remains unacknowledged unless the broker has
      // confirmed its handoff. A closed connection will requeue it itself.
      this.nack(channel, message);
    }
  }

  private async handoffToDlq(channel: ConfirmChannel, message: ConsumeMessage, reason: string): Promise<void> {
    try {
      await this.publishToDlqConfirmed(channel, message, reason);
      this.ack(channel, message);
    } catch {
      this.nack(channel, message);
    }
  }

  private async publishToDlqConfirmed(channel: ConfirmChannel, message: ConsumeMessage, reason: string): Promise<void> {
    await this.publishConfirmed(channel, '', this.dlq(), message, {
      ...message.properties.headers,
      'x-ai-risk-error': reason,
      'x-ai-risk-original-routing-key': message.fields.routingKey,
    });
  }

  private async publishConfirmed(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    message: ConsumeMessage,
    headers: Record<string, unknown>,
  ): Promise<void> {
    const publishId = randomUUID();
    const options = this.publishOptions(message, { ...headers, [PUBLISH_ID_HEADER]: publishId });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.pendingMandatoryReturns.delete(publishId);
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('RabbitMQ publisher confirm timed out')), this.publishConfirmTimeoutMs());
      this.pendingMandatoryReturns.set(publishId, (error) => finish(error));
      try {
        channel.publish(exchange, routingKey, message.content, options, (error) => {
          finish(error ? new Error('RabbitMQ publisher confirm failed') : undefined);
        });
      } catch {
        finish(new Error('RabbitMQ publish failed before confirmation'));
      }
    });
  }

  private publishOptions(message: ConsumeMessage, headers: Record<string, unknown>): Options.Publish {
    const properties = message.properties;
    return {
      persistent: true,
      mandatory: true,
      contentType: properties.contentType,
      contentEncoding: properties.contentEncoding,
      priority: properties.priority,
      correlationId: properties.correlationId,
      replyTo: properties.replyTo,
      expiration: properties.expiration,
      messageId: properties.messageId,
      timestamp: properties.timestamp,
      type: properties.type,
      userId: properties.userId,
      appId: properties.appId,
      headers,
    };
  }

  private handleMandatoryReturn(message: Message): void {
    const publishId = message.properties.headers?.[PUBLISH_ID_HEADER];
    if (typeof publishId !== 'string') return;
    this.pendingMandatoryReturns.get(publishId)?.(new Error('RabbitMQ returned an unroutable mandatory publish'));
  }

  private retryCount(message: ConsumeMessage): number {
    const value = Number(message.properties.headers?.['x-ai-risk-retry']);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private ack(channel: ConfirmChannel, message: ConsumeMessage): void {
    try { channel.ack(message); } catch { this.logger.warn('[AI Risk Consumer] ACK failed; broker will redeliver if the connection closes.'); }
  }

  private nack(channel: ConfirmChannel, message: ConsumeMessage): void {
    try { channel.nack(message, false, true); } catch { this.logger.warn('[AI Risk Consumer] NACK failed on closed channel; broker redelivery is relied upon.'); }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.pendingMandatoryReturns.clear();
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}

class PermanentAiRiskEventError extends Error {}
