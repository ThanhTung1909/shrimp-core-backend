import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRiskAlertsService } from './ai-risk-alerts.service.js';
import { validateAiRiskEvent } from './ai-risk-event.validation.js';

const payload = (risk_level: 'LOW' | 'MEDIUM' | 'HIGH' = 'HIGH') => validateAiRiskEvent({
  event_id: 'b4f73aed-1b4e-4bd2-8e1e-4da1bdf45788', event: 'ai.risk.detected',
  pond_id: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb', risk_level, predicted_metric: 'do_min',
  predicted_value: 2.8, action_suggestion: 'Kiểm tra sục khí', details: {}, timestamp: new Date().toISOString(),
}, 15);

describe('AiRiskAlertsService', () => {
  let manager: any; let dataSource: any; let alerts: any; let config: any; let service: AiRiskAlertsService;
  beforeEach(() => {
    manager = { insert: vi.fn().mockResolvedValue({}), findOne: vi.fn().mockResolvedValue({ pondId: 'pond' }), create: vi.fn((_, v) => ({ ...v })), save: vi.fn().mockResolvedValue({ alertId: 'alert-1' }), update: vi.fn().mockResolvedValue({}) };
    dataSource = { transaction: vi.fn((fn) => fn(manager)) };
    alerts = { publishAlertTriggered: vi.fn().mockResolvedValue(undefined) };
    config = { get: vi.fn((key) => key === 'AI_RISK_ALERTS_CONSUMER_ENABLED' || key === 'AI_PRODUCTION_INFERENCE_APPROVED' ? 'true' : undefined) };
    service = new AiRiskAlertsService(dataSource, alerts, config);
  });
  it('creates one CRITICAL alert then publishes after the transaction', async () => {
    await expect(service.process(payload('HIGH'))).resolves.toBe('CREATED');
    expect(manager.create).toHaveBeenCalledOnce();
    expect(alerts.publishAlertTriggered).toHaveBeenCalledWith(expect.objectContaining({ alertId: 'alert-1' }));
  });
  it('maps MEDIUM to an alert and LOW to a durable no-alert receipt', async () => {
    await expect(service.process(payload('MEDIUM'))).resolves.toBe('CREATED');
    expect(manager.create).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    await expect(service.process(payload('LOW'))).resolves.toBe('IGNORED_LOW');
    expect(manager.create).not.toHaveBeenCalled();
    expect(alerts.publishAlertTriggered).not.toHaveBeenCalled();
  });
  it('acknowledges a unique-constraint duplicate without a second alert', async () => {
    manager.insert.mockRejectedValueOnce({ code: '23505' });
    await expect(service.process(payload())).resolves.toBe('DUPLICATE');
    expect(manager.create).not.toHaveBeenCalled();
  });
  it('does not create alerts while production approval is off', async () => {
    config.get.mockImplementation((key: string) => key === 'AI_RISK_ALERTS_CONSUMER_ENABLED' ? 'true' : 'false');
    await expect(service.process(payload())).resolves.toBe('POLICY_DISABLED');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
