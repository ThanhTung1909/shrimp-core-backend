import { describe, expect, it, vi } from 'vitest';
import { AiRiskRabbitMqConsumer } from './ai-risk-rabbitmq.consumer.js';

const message = (body: unknown, routingKey = 'ai.risk.detected') => ({ content: Buffer.from(JSON.stringify(body)), fields: { routingKey }, properties: { headers: {} } }) as any;

describe('AiRiskRabbitMqConsumer', () => {
  const config = { get: vi.fn((key: string) => ({ AI_RISK_ALERTS_MAX_AGE_MINUTES: '15', AI_RISK_ALERTS_MAX_RETRIES: '1' }[key])) };
  it('moves malformed messages to the durable DLQ and acknowledges the original', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn() };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = { ack: vi.fn(), nack: vi.fn(), sendToQueue: vi.fn().mockReturnValue(true) };
    (consumer as any).channel = channel;
    await consumer.handle({ content: Buffer.from('{'), fields: { routingKey: 'ai.risk.detected' }, properties: { headers: {} } });
    expect(channel.sendToQueue).toHaveBeenCalledWith('ai_risk_alerts.dlq', expect.any(Buffer), expect.objectContaining({ persistent: true }));
    expect(channel.ack).toHaveBeenCalledOnce();
  });
  it('acks successful and duplicate processing without requeueing', async () => {
    const service = { isEnabled: vi.fn().mockReturnValue(true), process: vi.fn().mockResolvedValue('DUPLICATE') };
    const consumer = new AiRiskRabbitMqConsumer(config as any, service as any);
    const channel = { ack: vi.fn(), nack: vi.fn(), sendToQueue: vi.fn() };
    (consumer as any).channel = channel;
    await consumer.handle(message({ event_id: 'b4f73aed-1b4e-4bd2-8e1e-4da1bdf45788', event: 'ai.risk.detected', pond_id: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb', risk_level: 'HIGH', predicted_metric: 'do_min', predicted_value: 2.8, action_suggestion: 'Kiểm tra sục khí', details: {}, timestamp: new Date().toISOString() }));
    expect(channel.ack).toHaveBeenCalledOnce();
    expect(channel.nack).not.toHaveBeenCalled();
  });
});
