import { describe, expect, it, vi } from 'vitest';
import { AiRiskRabbitMqConsumer } from './ai-risk-rabbitmq.consumer.js';

const message = (body: unknown, routingKey = 'ai.risk.detected', headers: Record<string, unknown> = {}) => ({
  content: Buffer.from(JSON.stringify(body)), fields: { routingKey }, properties: { headers },
}) as any;

const validEvent = () => ({
  event_id: 'b4f73aed-1b4e-4bd2-8e1e-4da1bdf45788', event: 'ai.risk.detected',
  pond_id: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb', risk_level: 'HIGH', predicted_metric: 'do_min',
  predicted_value: 2.8, action_suggestion: 'Kiểm tra sục khí', details: {}, timestamp: new Date().toISOString(),
});

const confirmChannel = (confirmError: Error | null = null) => ({
  ack: vi.fn(),
  nack: vi.fn(),
  publish: vi.fn((_exchange, _routingKey, _content, _options, callback) => {
    callback?.(confirmError, {});
    return true;
  }),
});

describe('AiRiskRabbitMqConsumer', () => {
  const config = { get: vi.fn((key: string) => ({ AI_RISK_ALERTS_MAX_AGE_MINUTES: '15', AI_RISK_ALERTS_MAX_RETRIES: '1' }[key])) };

  it('moves malformed messages to the durable DLQ only after publisher confirmation', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn() };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel();
    await consumer.handle({ content: Buffer.from('{'), fields: { routingKey: 'ai.risk.detected' }, properties: { headers: {} } }, channel as any);
    expect(channel.publish).toHaveBeenCalledWith('', 'ai_risk_alerts.dlq', expect.any(Buffer), expect.objectContaining({ persistent: true, mandatory: true, headers: expect.objectContaining({ 'x-ai-risk-error': 'Malformed JSON' }) }), expect.any(Function));
    expect(channel.ack).toHaveBeenCalledOnce();
  });

  it('acks successful and duplicate processing without requeueing', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn().mockResolvedValue('DUPLICATE') };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel();
    await consumer.handle(message(validEvent()), channel as any);
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(channel.nack).not.toHaveBeenCalled();
    expect(channel.publish).not.toHaveBeenCalled();
  });

  it('retries transient failures through the topic exchange with the business routing key intact', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel();
    await consumer.handle(message(validEvent(), 'ai.risk.detected', { retained: 'metadata' }), channel as any);
    expect(channel.publish).toHaveBeenCalledWith('shrimp.events', 'ai.risk.detected', expect.any(Buffer), expect.objectContaining({
      persistent: true,
      mandatory: true,
      headers: expect.objectContaining({ retained: 'metadata', 'x-ai-risk-retry': 1 }),
    }), expect.any(Function));
    expect(channel.ack).toHaveBeenCalledOnce();
  });

  it('does not acknowledge the original transient delivery when its republish confirm fails', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel(new Error('broker rejected publish'));
    await consumer.handle(message(validEvent()), channel as any);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.any(Object), false, true);
  });

  it('sends validation failures directly to the DLQ instead of consuming retry budget', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn() };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel();
    await consumer.handle(message({ ...validEvent(), event_id: 'invalid' }), channel as any);
    expect(channel.publish).toHaveBeenCalledWith('', 'ai_risk_alerts.dlq', expect.any(Buffer), expect.objectContaining({ headers: expect.objectContaining({ 'x-ai-risk-error': 'event_id must be a UUID' }) }), expect.any(Function));
    expect(service.process).not.toHaveBeenCalled();
  });

  it.each([
    ['missing event ID', () => { const value = validEvent(); delete (value as any).event_id; return value; }],
    ['invalid pond ID', () => ({ ...validEvent(), pond_id: 'invalid' })],
    ['invalid risk level', () => ({ ...validEvent(), risk_level: 'CRITICAL' })],
    ['unsupported metric', () => ({ ...validEvent(), predicted_metric: 'salinity' })],
  ])('routes %s directly to the DLQ', async (_name, createInvalid) => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn() };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel();
    await consumer.handle(message(createInvalid()), channel as any);
    expect(channel.publish).toHaveBeenCalledWith('', 'ai_risk_alerts.dlq', expect.any(Buffer), expect.any(Object), expect.any(Function));
    expect(service.process).not.toHaveBeenCalled();
  });

  it('routes an oversized message and an unexpected routing key directly to the DLQ', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn() };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const oversized = { content: Buffer.alloc(8_193, 0), fields: { routingKey: 'ai.risk.detected' }, properties: { headers: {} } };
    const channel = confirmChannel();
    await consumer.handle(oversized, channel as any);
    await consumer.handle(message(validEvent(), 'ai.risk.unexpected'), channel as any);
    expect(channel.publish).toHaveBeenCalledTimes(2);
    expect(service.process).not.toHaveBeenCalled();
  });

  it('does not acknowledge a delivery returned by mandatory routing', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel: any = confirmChannel();
    channel.publish.mockImplementation((_exchange: string, _routing: string, _content: Buffer, options: any, callback: any) => {
      (consumer as any).handleMandatoryReturn({ properties: { headers: options.headers } });
      callback?.(null, {});
      return true;
    });
    await consumer.handle(message(validEvent()), channel);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.any(Object), false, true);
  });

  it('moves an exhausted transient event to the DLQ exactly once', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = confirmChannel();
    await consumer.handle(message(validEvent(), 'ai.risk.detected', { 'x-ai-risk-retry': 1 }), channel as any);
    expect(channel.publish).toHaveBeenCalledTimes(1);
    expect(channel.publish).toHaveBeenCalledWith('', 'ai_risk_alerts.dlq', expect.any(Buffer), expect.objectContaining({ headers: expect.objectContaining({ 'x-ai-risk-error': 'transient retry exhausted' }) }), expect.any(Function));
    expect(channel.ack).toHaveBeenCalledOnce();
  });
});
