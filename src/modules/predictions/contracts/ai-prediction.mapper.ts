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

// ============================================================================
// P2-1: Multi-horizon Water Quality Forecast & Disease Risk Assessment Contracts
// ============================================================================

export interface WaterQualityCurrentMetrics {
  currentDO: number;
  currentPH: number;
  currentTemp: number;
  salinity: number;
  turbidity: number;
}

export interface WaterQualityCurrentMetricsInput {
  currentDO?: unknown;
  currentPH?: unknown;
  currentTemp?: unknown;
  salinity?: unknown;
  turbidity?: unknown;
}

export interface WaterQualityHistoryPoint {
  recordedAt: string;
  dissolvedOxygen?: number;
  ph?: number;
  temperature?: number;
  salinity?: number;
  turbidity?: number;
}

export interface PondProfileInput {
  areaM2?: number;
  depthM?: number;
  shrimpDensity?: number;
  shrimpSpecies?: string;
  daysOfCulture?: number;
}

export interface WaterQualityForecastRequest {
  pondId: string;
  horizonHours: number;
  stepHours: number;
  timestamp: string;
  currentMetrics: WaterQualityCurrentMetrics;
  recentHistory?: WaterQualityHistoryPoint[];
  pondProfile?: PondProfileInput;
}

export interface WaterQualityForecastRequestInput {
  pondId?: unknown;
  horizonHours?: unknown;
  stepHours?: unknown;
  timestamp?: unknown;
  currentMetrics?: WaterQualityCurrentMetricsInput | null;
  recentHistory?: unknown;
  pondProfile?: unknown;
}

export type WaterQualityForecastRequestBuildResult =
  | { ok: true; value: WaterQualityForecastRequest }
  | { ok: false; reason: string };

export interface MappedWaterQualityForecastPoint {
  offsetHours: number;
  predictedTime: string;
  predictedDO: number;
  predictedPH: number;
  predictedTemperature: number;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface MappedWaterQualityForecastResponse {
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  series: MappedWaterQualityForecastPoint[];
  factors: string[];
  recommendations: string[];
}

export type WaterQualityForecastMappingResult =
  | { ok: true; value: MappedWaterQualityForecastResponse }
  | { ok: false; reason: string };

export interface DiseaseRiskCurrentMetrics extends WaterQualityCurrentMetrics {
  nh3?: number;
  no2?: number;
}

export interface DiseaseRiskCurrentMetricsInput extends WaterQualityCurrentMetricsInput {
  nh3?: unknown;
  no2?: unknown;
}

export interface DiseaseRiskVariability24h {
  temperatureDelta?: number;
  phDelta?: number;
  minDO?: number;
  minTemp?: number;
  maxTemp?: number;
}

export interface DiseaseRiskRequest {
  pondId: string;
  timestamp: string;
  currentMetrics: DiseaseRiskCurrentMetrics;
  variability24h?: DiseaseRiskVariability24h;
  pondProfile?: PondProfileInput;
}

export interface DiseaseRiskRequestInput {
  pondId?: unknown;
  timestamp?: unknown;
  currentMetrics?: DiseaseRiskCurrentMetricsInput | null;
  variability24h?: unknown;
  pondProfile?: unknown;
}

export type DiseaseRiskRequestBuildResult =
  | { ok: true; value: DiseaseRiskRequest }
  | { ok: false; reason: string };

export interface MappedDiseaseRiskItem {
  diseaseCode: string;
  diseaseName: string;
  riskScore: number;
  riskLevel: RiskLevel;
  indicators: string[];
  recommendations: string[];
}

export interface MappedDiseaseRiskResponse {
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  diseases: MappedDiseaseRiskItem[];
  recommendations: string[];
}

export type DiseaseRiskMappingResult =
  | { ok: true; value: MappedDiseaseRiskResponse }
  | { ok: false; reason: string };

const ALLOWED_STEP_HOURS = new Set([1, 2, 3, 4, 6]);
const REQUIRED_DISEASE_CODES = ['WSSV', 'AHPND_EMS'] as const;
const DEFAULT_DISEASE_NAMES: Record<string, string> = {
  WSSV: 'Bệnh đốm trắng (WSSV)',
  AHPND_EMS: 'Bệnh hoại tử gan tụy cấp (AHPND/EMS)',
};

export function buildWaterQualityForecastRequest(
  input: WaterQualityForecastRequestInput,
): WaterQualityForecastRequestBuildResult {
  if (typeof input.pondId !== 'string' || !isUuid(input.pondId)) {
    return { ok: false, reason: 'pondId must be a UUID' };
  }
  if (
    typeof input.horizonHours !== 'number' ||
    !Number.isInteger(input.horizonHours) ||
    input.horizonHours < 12 ||
    input.horizonHours > 24
  ) {
    return { ok: false, reason: 'horizonHours must be an integer in the inclusive range 12..24' };
  }
  if (
    typeof input.stepHours !== 'number' ||
    !Number.isInteger(input.stepHours) ||
    !ALLOWED_STEP_HOURS.has(input.stepHours)
  ) {
    return { ok: false, reason: 'stepHours must be one of 1, 2, 3, 4, 6' };
  }
  if (!isTimezoneAwareTimestamp(input.timestamp)) {
    return { ok: false, reason: 'timestamp must be a valid ISO-8601 value with timezone' };
  }

  const metricsResult = validateRequiredCurrentMetrics(input.currentMetrics);
  if (!metricsResult.ok) {
    return metricsResult;
  }

  const request: WaterQualityForecastRequest = {
    pondId: input.pondId,
    horizonHours: input.horizonHours,
    stepHours: input.stepHours,
    timestamp: input.timestamp,
    currentMetrics: metricsResult.value,
  };

  const recentHistory = sanitizeRecentHistory(input.recentHistory);
  if (recentHistory.length > 0) {
    request.recentHistory = recentHistory;
  }

  const pondProfile = sanitizePondProfile(input.pondProfile);
  if (pondProfile) {
    request.pondProfile = pondProfile;
  }

  return { ok: true, value: request };
}

export function mapWaterQualityForecastResponse(
  payload: unknown,
): WaterQualityForecastMappingResult {
  if (!isRecord(payload)) {
    return { ok: false, reason: 'response is not an object' };
  }

  const rawOverallRiskScore = numberField(payload, 'overallRiskScore');
  if (rawOverallRiskScore === null || rawOverallRiskScore < 0 || rawOverallRiskScore > 100) {
    return {
      ok: false,
      reason: 'overallRiskScore must be a number in the inclusive range 0..100',
    };
  }

  const rawOverallRiskLevel = payload.overallRiskLevel;
  if (typeof rawOverallRiskLevel !== 'string' || !RISK_LEVEL_MAP[rawOverallRiskLevel]) {
    return { ok: false, reason: 'overallRiskLevel must be one of SAFE, WARNING, DANGER' };
  }

  if (!Array.isArray(payload.series) || payload.series.length === 0) {
    return { ok: false, reason: 'series must be a non-empty array' };
  }

  const rawSeries: unknown[] = payload.series;
  const series: MappedWaterQualityForecastPoint[] = [];
  for (let index = 0; index < rawSeries.length; index += 1) {
    const point: unknown = rawSeries[index];
    if (!isRecord(point)) {
      return { ok: false, reason: `series[${index}] is not an object` };
    }

    const offsetHours = numberField(point, 'offsetHours');
    const predictedDO = numberField(point, 'predictedDO');
    const predictedPH = numberField(point, 'predictedPH');
    const predictedTemperature = numberField(point, 'predictedTemperature');
    const rawRiskScore = numberField(point, 'riskScore');
    const rawRiskLevel = point.riskLevel;

    if (offsetHours === null || offsetHours <= 0) {
      return { ok: false, reason: `series[${index}].offsetHours must be a finite number > 0` };
    }
    if (!isTimezoneAwareTimestamp(point.predictedTime)) {
      return {
        ok: false,
        reason: `series[${index}].predictedTime must be a valid ISO-8601 timestamp with timezone`,
      };
    }
    if (predictedDO === null) {
      return { ok: false, reason: `series[${index}].predictedDO must be a finite number` };
    }
    if (predictedPH === null) {
      return { ok: false, reason: `series[${index}].predictedPH must be a finite number` };
    }
    if (predictedTemperature === null) {
      return {
        ok: false,
        reason: `series[${index}].predictedTemperature must be a finite number`,
      };
    }
    if (rawRiskScore === null || rawRiskScore < 0 || rawRiskScore > 100) {
      return {
        ok: false,
        reason: `series[${index}].riskScore must be a number in the inclusive range 0..100`,
      };
    }
    if (typeof rawRiskLevel !== 'string' || !RISK_LEVEL_MAP[rawRiskLevel]) {
      return {
        ok: false,
        reason: `series[${index}].riskLevel must be one of SAFE, WARNING, DANGER`,
      };
    }

    series.push({
      offsetHours,
      predictedTime: point.predictedTime,
      predictedDO,
      predictedPH,
      predictedTemperature,
      riskScore: rawRiskScore / 100,
      riskLevel: RISK_LEVEL_MAP[rawRiskLevel],
    });
  }

  const factors = parseOptionalStringArray(payload.factors, 'factors');
  if (!factors.ok) return factors;

  const recommendations = parseOptionalStringArray(payload.recommendations, 'recommendations');
  if (!recommendations.ok) return recommendations;

  return {
    ok: true,
    value: {
      overallRiskScore: rawOverallRiskScore / 100,
      overallRiskLevel: RISK_LEVEL_MAP[rawOverallRiskLevel],
      series,
      factors: factors.value,
      recommendations: recommendations.value,
    },
  };
}

export function buildDiseaseRiskRequest(
  input: DiseaseRiskRequestInput,
): DiseaseRiskRequestBuildResult {
  if (typeof input.pondId !== 'string' || !isUuid(input.pondId)) {
    return { ok: false, reason: 'pondId must be a UUID' };
  }
  if (!isTimezoneAwareTimestamp(input.timestamp)) {
    return { ok: false, reason: 'timestamp must be a valid ISO-8601 value with timezone' };
  }

  const metricsResult = validateRequiredCurrentMetrics(input.currentMetrics);
  if (!metricsResult.ok) {
    return metricsResult;
  }

  const currentMetrics: DiseaseRiskCurrentMetrics = { ...metricsResult.value };
  const rawMetrics = input.currentMetrics as DiseaseRiskCurrentMetricsInput;

  if (rawMetrics.nh3 !== undefined && rawMetrics.nh3 !== null) {
    if (typeof rawMetrics.nh3 !== 'number' || !Number.isFinite(rawMetrics.nh3) || rawMetrics.nh3 < 0 || rawMetrics.nh3 > 20) {
      return { ok: false, reason: 'currentMetrics.nh3 must be a finite number in the inclusive range 0..20' };
    }
    currentMetrics.nh3 = rawMetrics.nh3;
  }

  if (rawMetrics.no2 !== undefined && rawMetrics.no2 !== null) {
    if (typeof rawMetrics.no2 !== 'number' || !Number.isFinite(rawMetrics.no2) || rawMetrics.no2 < 0 || rawMetrics.no2 > 50) {
      return { ok: false, reason: 'currentMetrics.no2 must be a finite number in the inclusive range 0..50' };
    }
    currentMetrics.no2 = rawMetrics.no2;
  }

  const request: DiseaseRiskRequest = {
    pondId: input.pondId,
    timestamp: input.timestamp,
    currentMetrics,
  };

  const variability24h = sanitizeVariability24h(input.variability24h);
  if (variability24h) {
    request.variability24h = variability24h;
  }

  const pondProfile = sanitizePondProfile(input.pondProfile);
  if (pondProfile) {
    request.pondProfile = pondProfile;
  }

  return { ok: true, value: request };
}

export function mapDiseaseRiskResponse(payload: unknown): DiseaseRiskMappingResult {
  if (!isRecord(payload)) {
    return { ok: false, reason: 'response is not an object' };
  }

  const rawOverallRiskScore = numberField(payload, 'overallRiskScore');
  if (rawOverallRiskScore === null || rawOverallRiskScore < 0 || rawOverallRiskScore > 100) {
    return {
      ok: false,
      reason: 'overallRiskScore must be a number in the inclusive range 0..100',
    };
  }

  const rawOverallRiskLevel = payload.overallRiskLevel;
  if (typeof rawOverallRiskLevel !== 'string' || !RISK_LEVEL_MAP[rawOverallRiskLevel]) {
    return { ok: false, reason: 'overallRiskLevel must be one of SAFE, WARNING, DANGER' };
  }

  if (!Array.isArray(payload.diseases) || payload.diseases.length === 0) {
    return { ok: false, reason: 'diseases must be a non-empty array' };
  }

  const rawDiseases: unknown[] = payload.diseases;
  const diseases: MappedDiseaseRiskItem[] = [];
  const seenCodes = new Set<string>();

  for (let index = 0; index < rawDiseases.length; index += 1) {
    const item: unknown = rawDiseases[index];
    if (!isRecord(item)) {
      return { ok: false, reason: `diseases[${index}] is not an object` };
    }

    const rawCode = item.code ?? item.diseaseCode;
    if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
      return { ok: false, reason: `diseases[${index}].code must be a non-empty string` };
    }
    const diseaseCode = rawCode.trim();
    if (seenCodes.has(diseaseCode)) {
      return { ok: false, reason: `duplicate disease code "${diseaseCode}" in diseases` };
    }
    seenCodes.add(diseaseCode);

    const rawRiskScore = numberField(item, 'riskScore');
    if (rawRiskScore === null || rawRiskScore < 0 || rawRiskScore > 100) {
      return {
        ok: false,
        reason: `diseases[${index}].riskScore must be a number in the inclusive range 0..100`,
      };
    }

    const rawRiskLevel = item.riskLevel;
    if (typeof rawRiskLevel !== 'string' || !RISK_LEVEL_MAP[rawRiskLevel]) {
      return {
        ok: false,
        reason: `diseases[${index}].riskLevel must be one of SAFE, WARNING, DANGER`,
      };
    }

    const indicators = parseOptionalStringArray(item.indicators, `diseases[${index}].indicators`);
    if (!indicators.ok) return indicators;

    const itemRecommendations = parseOptionalStringArray(
      item.recommendations,
      `diseases[${index}].recommendations`,
    );
    if (!itemRecommendations.ok) return itemRecommendations;

    const rawName = item.name ?? item.diseaseName;
    const diseaseName =
      typeof rawName === 'string' && rawName.trim().length > 0
        ? rawName.trim()
        : DEFAULT_DISEASE_NAMES[diseaseCode] ?? diseaseCode;

    diseases.push({
      diseaseCode,
      diseaseName,
      riskScore: rawRiskScore / 100,
      riskLevel: RISK_LEVEL_MAP[rawRiskLevel],
      indicators: indicators.value,
      recommendations: itemRecommendations.value,
    });
  }

  for (const requiredCode of REQUIRED_DISEASE_CODES) {
    if (!seenCodes.has(requiredCode)) {
      return {
        ok: false,
        reason: `diseases must include both ${REQUIRED_DISEASE_CODES.join(' and ')} (missing ${requiredCode})`,
      };
    }
  }

  const recommendations = parseOptionalStringArray(payload.recommendations, 'recommendations');
  if (!recommendations.ok) return recommendations;

  return {
    ok: true,
    value: {
      overallRiskScore: rawOverallRiskScore / 100,
      overallRiskLevel: RISK_LEVEL_MAP[rawOverallRiskLevel],
      diseases,
      recommendations: recommendations.value,
    },
  };
}

function validateRequiredCurrentMetrics(
  metrics: unknown,
): { ok: true; value: WaterQualityCurrentMetrics } | { ok: false; reason: string } {
  if (!isRecord(metrics)) {
    return { ok: false, reason: 'currentMetrics must be an object' };
  }

  const fields: Array<[keyof WaterQualityCurrentMetrics, unknown, number, number]> = [
    ['currentDO', metrics.currentDO, 0, 15],
    ['currentPH', metrics.currentPH, 5.5, 10],
    ['currentTemp', metrics.currentTemp, 15, 42],
    ['salinity', metrics.salinity, 0, 45],
    ['turbidity', metrics.turbidity, 0, 200],
  ];

  for (const [field, value, minimum, maximum] of fields) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      return {
        ok: false,
        reason: `currentMetrics.${field} must be a finite number in the inclusive range ${minimum}..${maximum}`,
      };
    }
  }

  return {
    ok: true,
    value: {
      currentDO: metrics.currentDO as number,
      currentPH: metrics.currentPH as number,
      currentTemp: metrics.currentTemp as number,
      salinity: metrics.salinity as number,
      turbidity: metrics.turbidity as number,
    },
  };
}

const RECENT_HISTORY_METRIC_BOUNDS: Record<
  Exclude<keyof WaterQualityHistoryPoint, 'recordedAt'>,
  readonly [number, number]
> = {
  dissolvedOxygen: [0, 25],
  ph: [4, 11],
  temperature: [10, 45],
  salinity: [0, 50],
  turbidity: [0, 500],
};

function sanitizeRecentHistory(raw: unknown): WaterQualityHistoryPoint[] {
  if (!Array.isArray(raw)) return [];

  const points: WaterQualityHistoryPoint[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const recordedAt = entry.recordedAt ?? entry.timestamp;
    if (!isTimezoneAwareTimestamp(recordedAt)) {
      continue;
    }
    const point: WaterQualityHistoryPoint = { recordedAt };
    let hasMetric = false;

    for (const key of ['dissolvedOxygen', 'ph', 'temperature', 'salinity', 'turbidity'] as const) {
      const value = entry[key];
      const [min, max] = RECENT_HISTORY_METRIC_BOUNDS[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
        point[key] = value;
        hasMetric = true;
      }
    }

    if (hasMetric) {
      points.push(point);
    }
  }
  return points;
}

function sanitizeVariability24h(raw: unknown): DiseaseRiskVariability24h | undefined {
  if (!isRecord(raw)) return undefined;

  const result: DiseaseRiskVariability24h = {};
  let hasField = false;

  for (const key of ['temperatureDelta', 'phDelta', 'minDO', 'minTemp', 'maxTemp'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      if ((key === 'temperatureDelta' || key === 'phDelta') && value < 0) {
        continue;
      }
      result[key] = value;
      hasField = true;
    }
  }

  return hasField ? result : undefined;
}

function sanitizePondProfile(raw: unknown): PondProfileInput | undefined {
  if (!isRecord(raw)) return undefined;

  const profile: PondProfileInput = {};
  let hasField = false;

  for (const key of ['areaM2', 'depthM', 'shrimpDensity'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      profile[key] = value;
      hasField = true;
    }
  }

  if (typeof raw.daysOfCulture === 'number' && Number.isFinite(raw.daysOfCulture) && raw.daysOfCulture >= 0) {
    profile.daysOfCulture = Math.floor(raw.daysOfCulture);
    hasField = true;
  }

  if (typeof raw.shrimpSpecies === 'string' && raw.shrimpSpecies.trim().length > 0) {
    profile.shrimpSpecies = raw.shrimpSpecies.trim();
    hasField = true;
  }

  return hasField ? profile : undefined;
}

function parseOptionalStringArray(
  value: unknown,
  fieldName: string,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, reason: `${fieldName} must be an array of strings` };
  }
  const normalized: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') {
      return { ok: false, reason: `${fieldName}[${i}] must be a string` };
    }
    normalized.push(value[i]);
  }
  return { ok: true, value: normalized };
}
