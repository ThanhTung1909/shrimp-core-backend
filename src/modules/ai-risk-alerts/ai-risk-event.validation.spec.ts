import { describe, expect, it } from 'vitest';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { mapRiskLevel, validateAiRiskEvent } from './ai-risk-event.validation.js';

const event = () => ({
  event_id: 'b4f73aed-1b4e-4bd2-8e1e-4da1bdf45788', event: 'ai.risk.detected',
  pond_id: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb', risk_level: 'HIGH',
  predicted_metric: 'dissolved_oxygen', predicted_value: 2.8,
  action_suggestion: 'Kiểm tra hệ thống sục khí', details: {}, timestamp: new Date().toISOString(),
});

describe('AI risk event validation', () => {
  it('accepts a bounded, identified AI event and maps risk levels', () => {
    expect(validateAiRiskEvent(event(), 15).risk_level).toBe('HIGH');
    expect(mapRiskLevel('HIGH')).toBe(AlertLevel.CRITICAL);
    expect(mapRiskLevel('MEDIUM')).toBe(AlertLevel.WARNING);
    expect(mapRiskLevel('LOW')).toBeNull();
  });
  it('rejects legacy events without event_id rather than inventing a dedupe key', () => {
    const payload = event(); delete (payload as any).event_id;
    expect(() => validateAiRiskEvent(payload, 15)).toThrow('event_id');
  });
  it.each([
    ['invalid pond', { pond_id: 'not-a-uuid' }],
    ['invalid event', { event: 'unexpected' }],
    ['non-finite value', { predicted_value: Infinity }],
    ['stale timestamp', { timestamp: new Date(Date.now() - 16 * 60_000).toISOString() }],
  ])('rejects %s', (_, override) => expect(() => validateAiRiskEvent({ ...event(), ...override }, 15)).toThrow());
});
