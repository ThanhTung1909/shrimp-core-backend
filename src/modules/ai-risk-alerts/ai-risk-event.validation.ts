import { AlertLevel } from '../../common/enums/alert-level.enum.js';

export interface AiRiskEvent {
  event_id: string;
  event: 'ai.risk.detected';
  pond_id: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  predicted_metric: string;
  predicted_value: number;
  action_suggestion: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export type ValidatedAiRiskEvent = AiRiskEvent & { occurredAt: Date };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METRICS = new Set(['dissolved_oxygen', 'do_min', 'feeding_intake', 'water_quality']);

export function validateAiRiskEvent(value: unknown, maxAgeMinutes: number, now = new Date()): ValidatedAiRiskEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Payload must be an object');
  const event = value as Partial<AiRiskEvent>;
  if (event.event !== 'ai.risk.detected') throw new Error('Unsupported event type');
  if (!event.event_id || !UUID.test(event.event_id)) throw new Error('event_id must be a UUID');
  if (!event.pond_id || !UUID.test(event.pond_id)) throw new Error('pond_id must be a UUID');
  if (event.risk_level !== 'LOW' && event.risk_level !== 'MEDIUM' && event.risk_level !== 'HIGH') throw new Error('Invalid risk level');
  if (!event.predicted_metric || !METRICS.has(event.predicted_metric)) throw new Error('Invalid predicted metric');
  if (!Number.isFinite(event.predicted_value)) throw new Error('predicted_value must be finite');
  if (!event.action_suggestion || event.action_suggestion.length > 500) throw new Error('Invalid action suggestion');
  if (!event.details || typeof event.details !== 'object' || Array.isArray(event.details) || JSON.stringify(event.details).length > 4096) throw new Error('Invalid details');
  if (!event.timestamp) throw new Error('Missing timestamp');
  const occurredAt = new Date(event.timestamp);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt > now || now.getTime() - occurredAt.getTime() > maxAgeMinutes * 60_000) throw new Error('Invalid or stale timestamp');
  return { ...(event as AiRiskEvent), occurredAt };
}

export function mapRiskLevel(riskLevel: AiRiskEvent['risk_level']): AlertLevel | null {
  if (riskLevel === 'HIGH') return AlertLevel.CRITICAL;
  if (riskLevel === 'MEDIUM') return AlertLevel.WARNING;
  return null;
}
