import { RiskLevel } from '../../../common/enums/risk-level.enum.js';

/**
 * Boundary contract for the configured AI prediction endpoint.
 *
 * The endpoint is an external dependency: all values are treated as unknown
 * until they have passed this mapper.  The response vocabulary is deliberately
 * kept out of the persistence/domain layer.
 */
export interface AiPredictionRequest {
  pondId: string;
  currentDO: number;
  currentPH: number;
  currentTemp: number;
  timestamp: string;
  salinity: number;
  turbidity: number;
}

/** Values collected by Core before they are admitted to the FastAPI contract. */
export interface AiPredictionRequestInput {
  pondId?: unknown;
  currentDO?: unknown;
  currentPH?: unknown;
  currentTemp?: unknown;
  timestamp?: unknown;
  salinity?: unknown;
  turbidity?: unknown;
}

export interface MappedAiPredictionResponse {
  predictedDO: number;
  predictedPH: number;
  riskScore: number;
  riskLevel: RiskLevel;
}

export type AiPredictionMappingResult =
  | { ok: true; value: MappedAiPredictionResponse }
  | { ok: false; reason: string };

export type AiPredictionRequestBuildResult =
  | { ok: true; value: AiPredictionRequest }
  | { ok: false; reason: string };

type UnknownRecord = Record<string, unknown>;

const RISK_LEVEL_MAP: Record<string, RiskLevel> = {
  SAFE: RiskLevel.LOW,
  WARNING: RiskLevel.MEDIUM,
  DANGER: RiskLevel.HIGH,
};

/**
 * Builds only payloads that FastAPI's ``ForecastRequest`` can accept.
 *
 * Core must not turn a missing sensor reading into a made-up value simply to
 * call AI. Returning a typed failure lets PredictionsService choose its normal
 * heuristic fallback before making an avoidable HTTP request that would be
 * rejected with 422.
 */
export function buildAiPredictionRequest(input: AiPredictionRequestInput): AiPredictionRequestBuildResult {
  if (typeof input.pondId !== 'string' || !isUuid(input.pondId)) {
    return { ok: false, reason: 'pondId must be a UUID' };
  }
  if (!isTimezoneAwareTimestamp(input.timestamp)) {
    return { ok: false, reason: 'timestamp must be a valid ISO-8601 value with timezone' };
  }

  const fields: Array<[keyof Omit<AiPredictionRequest, 'pondId' | 'timestamp'>, unknown, number, number]> = [
    ['currentDO', input.currentDO, 0, 15],
    ['currentPH', input.currentPH, 5.5, 10],
    ['currentTemp', input.currentTemp, 15, 42],
    ['salinity', input.salinity, 0, 45],
    ['turbidity', input.turbidity, 0, 200],
  ];

  for (const [field, value, minimum, maximum] of fields) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      return { ok: false, reason: `${field} must be a finite number in the inclusive range ${minimum}..${maximum}` };
    }
  }

  return {
    ok: true,
    value: {
      pondId: input.pondId,
      currentDO: input.currentDO as number,
      currentPH: input.currentPH as number,
      currentTemp: input.currentTemp as number,
      timestamp: input.timestamp,
      salinity: input.salinity as number,
      turbidity: input.turbidity as number,
    },
  };
}

/** Maps the documented AI response (SAFE|WARNING|DANGER, score 0..100) to the domain model. */
export function mapAiPredictionResponse(payload: unknown): AiPredictionMappingResult {
  if (!isRecord(payload)) return { ok: false, reason: 'response is not an object' };

  const predictedDO = numberField(payload, 'predictedDO');
  const predictedPH = numberField(payload, 'predictedPH');
  const rawRiskScore = numberField(payload, 'riskScore');
  const rawRiskLevel = payload.riskLevel;

  if (predictedDO === null) return { ok: false, reason: 'predictedDO must be a finite number' };
  if (predictedPH === null) return { ok: false, reason: 'predictedPH must be a finite number' };
  if (rawRiskScore === null || rawRiskScore < 0 || rawRiskScore > 100) {
    return { ok: false, reason: 'riskScore must be a number in the inclusive range 0..100' };
  }
  if (typeof rawRiskLevel !== 'string' || !RISK_LEVEL_MAP[rawRiskLevel]) {
    return { ok: false, reason: 'riskLevel must be one of SAFE, WARNING, DANGER' };
  }

  return {
    ok: true,
    value: {
      predictedDO,
      predictedPH,
      riskScore: rawRiskScore / 100,
      riskLevel: RISK_LEVEL_MAP[rawRiskLevel],
    },
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(record: UnknownRecord, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isUuid(value: string): boolean {
  // FastAPI/Pydantic accepts canonical UUIDs without restricting the version.
  // Keep this boundary aligned so Core does not reject a database UUID that
  // FastAPI would otherwise accept (for example a future UUIDv7 identifier).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function isTimezoneAwareTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /(?:Z|[+-]\d{2}:\d{2})$/iu.test(value)
    && Number.isFinite(Date.parse(value));
}
