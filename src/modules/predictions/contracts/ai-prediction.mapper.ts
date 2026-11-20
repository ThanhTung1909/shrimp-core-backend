import { RiskLevel } from '../../../common/enums/risk-level.enum.js';

/**
 * Contract tại ranh giới với endpoint AI prediction đã cấu hình.
 *
 * Endpoint là dependency bên ngoài: mọi giá trị được xem là chưa xác định
 * cho đến khi đi qua mapper này. Từ vựng của response được chủ động tách khỏi
 * tầng persistence/domain.
 */
export interface AiPredictionRequest {
  pondId: string;
  /** FastAPI develop vocabulary: temperature in degrees Celsius. */
  temperature: number;
  /** FastAPI develop vocabulary: pH. */
  ph: number;
  /** FastAPI develop vocabulary: dissolved oxygen in mg/L. */
  dissolvedOxygen: number;
  timestamp: string;
  salinity: number;
  turbidity: number;
}

/**
 * Phiên bản adapter một chiều từ telemetry Core sang contract FastAPI
 * `/api/predict`. Version không được đưa vào JSON vì FastAPI không nhận
 * field này và schema không được âm thầm bỏ qua contract trùng lặp.
 */
export const AI_PREDICTION_CONTRACT_VERSION = 'ai-develop-v1' as const;
export type AiPredictionContractVersion = typeof AI_PREDICTION_CONTRACT_VERSION;

/** Các giá trị Core thu thập trước khi được chấp nhận vào contract FastAPI. */
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
 * Chỉ tạo payload mà `ForecastRequest` của FastAPI có thể chấp nhận.
 *
 * Core không được biến số đo cảm biến bị thiếu thành giá trị giả chỉ để gọi AI.
 * Trả về lỗi có kiểu cho phép PredictionsService chọn heuristic fallback thông
 * thường trước khi tạo một HTTP request có thể tránh được và sẽ bị từ chối 422.
 */
export function buildAiPredictionRequest(
  input: AiPredictionRequestInput,
  contractVersion: string = AI_PREDICTION_CONTRACT_VERSION,
): AiPredictionRequestBuildResult {
  if (contractVersion !== AI_PREDICTION_CONTRACT_VERSION) {
    return { ok: false, reason: `unsupported AI prediction contract version: ${contractVersion}` };
  }
  if (typeof input.pondId !== 'string' || !isUuid(input.pondId)) {
    return { ok: false, reason: 'pondId must be a UUID' };
  }
  if (!isTimezoneAwareTimestamp(input.timestamp)) {
    return { ok: false, reason: 'timestamp must be a valid ISO-8601 value with timezone' };
  }

  const fields: Array<[keyof AiPredictionRequestInput, unknown, number, number]> = [
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
      temperature: input.currentTemp as number,
      ph: input.currentPH as number,
      dissolvedOxygen: input.currentDO as number,
      timestamp: input.timestamp,
      salinity: input.salinity as number,
      turbidity: input.turbidity as number,
    },
  };
}

/** Ánh xạ response AI đã tài liệu hóa (SAFE|WARNING|DANGER, score 0..100) sang domain model. */
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
  // FastAPI/Pydantic chấp nhận UUID canonical mà không giới hạn phiên bản.
  // Giữ ranh giới này đồng bộ để Core không từ chối UUID từ database mà
  // FastAPI vẫn chấp nhận (ví dụ UUIDv7 trong tương lai).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function isTimezoneAwareTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /(?:Z|[+-]\d{2}:\d{2})$/iu.test(value)
    && Number.isFinite(Date.parse(value));
}
