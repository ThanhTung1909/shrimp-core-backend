import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AiPrediction } from './entities/ai-prediction.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { ManualTestLog } from '../ponds/entities/manual-test-log.entity.js';
import { ShrimpBatch } from '../crops/entities/shrimp-batch.entity.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { PredictionType } from '../../common/enums/prediction-type.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { ShrimpBatchStatus } from '../../common/enums/shrimp-batch-status.enum.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { TelemetryData } from '../telemetry/entities/telemetry-data.entity.js';
import { PondsService } from '../ponds/ponds.service.js';
import { AiPredictionHttpClient } from './clients/ai-prediction-http.client.js';
import {
  buildAiPredictionRequest,
  buildDiseaseRiskRequest,
  buildWaterQualityForecastRequest,
  mapAiPredictionResponse,
  mapDiseaseRiskResponse,
  mapWaterQualityForecastResponse,
  type PondProfileInput,
  type WaterQualityHistoryPoint,
} from './contracts/ai-prediction.mapper.js';
import { QueryWaterQualityForecastDto } from './dto/query-water-quality-forecast.dto.js';
import { QueryDiseaseRiskDto } from './dto/query-disease-risk.dto.js';
import {
  DiseaseRiskInputSnapshotDto,
  DiseaseRiskItemDto,
  DiseaseRiskResponseDto,
  WaterQualityCurrentMetricsDto,
  WaterQualityForecastPointDto,
  WaterQualityForecastResponseDto,
  WaterQualityForecastSummaryDto,
} from './dto/prediction-response.dto.js';

const DEFAULT_CACHE_TTL_MINUTES = 15;
const DEFAULT_BASELINE_DO = 5.5;
const DEFAULT_BASELINE_PH = 7.8;
const DEFAULT_BASELINE_TEMP = 28.0;
const SOURCE_AI_MICROSERVICE = 'AI_MICROSERVICE';
const SOURCE_HEURISTIC_RULE = 'HEURISTIC_RULE';

interface PondTelemetryBundle {
  latest: TelemetryData | null;
  history24h: TelemetryData[];
}

interface Variability24hMetrics {
  temperatureDelta: number | null;
  phDelta: number | null;
  minDO: number | null;
  minTemp: number | null;
  maxTemp: number | null;
}

interface WaterQualityHeuristicOutput {
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  series: WaterQualityForecastPointDto[];
  factors: string[];
  recommendations: string[];
}

interface DiseaseRiskHeuristicOutput {
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  diseases: DiseaseRiskItemDto[];
  recommendations: string[];
}

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);
  private readonly httpClient: AiPredictionHttpClient;

  constructor(
    @InjectRepository(AiPrediction)
    private readonly predictionRepo: Repository<AiPrediction>,
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
    private readonly configService: ConfigService,
    private readonly telemetryService?: TelemetryService,
    @Optional()
    private readonly pondsService?: PondsService,
    @Optional()
    private readonly aiHttpClient?: AiPredictionHttpClient,
    @Optional()
    @InjectRepository(ManualTestLog)
    private readonly manualLogRepo?: Repository<ManualTestLog>,
    @Optional()
    @InjectRepository(ShrimpBatch)
    private readonly shrimpBatchRepo?: Repository<ShrimpBatch>,
  ) {
    this.httpClient = this.aiHttpClient ?? new AiPredictionHttpClient(this.configService);
  }

  /**
   * Lấy danh sách ID của các ao nuôi đang hoạt động (ACTIVE)
   */
  async getActivePondIds(): Promise<string[]> {
    const activePonds = await this.pondRepo.find({
      where: { status: PondStatus.ACTIVE },
      select: ['pondId'],
    });
    return activePonds.map((p) => p.pondId);
  }

  /**
   * Kích hoạt dự báo chất lượng nước và đánh giá rủi ro cho một ao nuôi (AQS-101/AQS-102):
   * 1. Kiểm tra ao nuôi & phân quyền
   * 2. Lấy chỉ số cảm biến gần nhất từ TelemetryService (nếu có thiết bị gán vào ao)
   * 3. Gọi AI Model Service ngoại vi hoặc sử dụng mô hình nội bộ để tính toán DO, pH, Risk
   * 4. Lưu bản ghi kết quả vào bảng ai_prediction
   */
  async predictForPond(
    pondId: string,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<AiPrediction> {
    const pond = await this.findPondForPrediction(pondId, actorUserId, actorRole);

    if (!pond) {
      throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${pondId}`);
    }

    // Lấy số liệu cảm biến mới nhất từ thiết bị của ao (nếu có)
    let currentDO = DEFAULT_BASELINE_DO;
    let currentPH = DEFAULT_BASELINE_PH;
    let currentTemp = DEFAULT_BASELINE_TEMP;
    let salinity: number | undefined;
    let turbidity: number | undefined;

    if (pond.devices && pond.devices.length > 0 && this.telemetryService) {
      for (const dev of pond.devices) {
        const latestTelemetry = await this.telemetryService.getLatestByDeviceId(dev.deviceId);
        if (latestTelemetry) {
          const dissolvedOxygen = asFiniteNumber(latestTelemetry.dissolvedOxygen);
          const ph = asFiniteNumber(latestTelemetry.ph);
          const temperature = asFiniteNumber(latestTelemetry.temperature);
          const latestSalinity = asFiniteNumber(latestTelemetry.salinity);
          const latestTurbidity = asFiniteNumber(latestTelemetry.turbidity);

          if (dissolvedOxygen !== undefined) currentDO = dissolvedOxygen;
          if (ph !== undefined) currentPH = ph;
          if (temperature !== undefined) currentTemp = temperature;
          salinity = latestSalinity;
          turbidity = latestTurbidity;
          break;
        }
      }
    }

    let predictedDO = currentDO;
    let predictedPH = currentPH;
    let riskScore = 0.1;
    let riskLevel: RiskLevel = RiskLevel.LOW;

    // Thử gọi AI Microservice nếu có cấu hình (kèm Timeout qua AiPredictionHttpClient)
    let externalAiSuccess = false;
    const aiRequest = buildAiPredictionRequest({
      pondId,
      currentDO,
      currentPH,
      currentTemp,
      timestamp: new Date().toISOString(),
      salinity,
      turbidity,
    });

    if (aiRequest.ok) {
      const httpResult = await this.httpClient.predictLegacy(aiRequest.value);
      if (httpResult.ok) {
        const mapped = mapAiPredictionResponse(httpResult.data);
        if (mapped.ok) {
          predictedDO = mapped.value.predictedDO;
          predictedPH = mapped.value.predictedPH;
          riskScore = mapped.value.riskScore;
          riskLevel = mapped.value.riskLevel;
          externalAiSuccess = true;
          this.logger.log(`[AI Prediction] Nhận kết quả hợp lệ từ AI Microservice cho ao ${pondId}`);
        } else {
          this.logger.warn(
            `[AI Prediction Contract Warning] Phản hồi AI không hợp lệ cho ao ${pondId}: ${mapped.reason}. Sử dụng mô hình ước tính tích hợp.`,
          );
        }
      } else if (httpResult.category !== 'NOT_CONFIGURED') {
        const categoryLabel =
          httpResult.category === 'TIMEOUT'
            ? 'Timeout'
            : httpResult.category === 'INVALID_JSON'
              ? 'Contract'
              : 'Transport';
        const detail =
          httpResult.category === 'HTTP_ERROR'
            ? `AI Microservice trả HTTP ${httpResult.status}`
            : `Không thể lấy dự báo AI: ${httpResult.message}`;
        this.logger.warn(
          `[AI Prediction ${categoryLabel} Warning] ${detail} cho ao ${pondId}. Sử dụng mô hình ước tính tích hợp.`,
        );
      }
    } else if (this.httpClient.resolveEndpointUrl('legacy')) {
      this.logger.warn(
        `[AI Prediction Request Warning] Không gọi AI cho ao ${pondId}: ${aiRequest.reason}. Sử dụng mô hình ước tính tích hợp.`,
      );
    }

    // Nếu không có external service hoặc gọi thất bại, sử dụng mô hình dự báo tích hợp
    if (!externalAiSuccess) {
      // Mô hình ước tính dự báo: Nồng độ DO có xu hướng giảm nhẹ về đêm/rạng sáng (-0.3 đến -0.6 mg/L)
      const doDelta = currentTemp > 30 ? -0.5 : -0.3;
      predictedDO = Math.max(1.0, Number((currentDO + doDelta).toFixed(2)));
      predictedPH = Number((currentPH + 0.05).toFixed(2));

      // Tính điểm rủi ro dựa trên ngưỡng an toàn thủy sản (DO tối ưu > 4.5 mg/L, pH tối ưu 7.5 - 8.5)
      let calculatedRisk = 0.1;
      if (predictedDO < 4.0) calculatedRisk += 0.4;
      if (predictedDO < 3.0) calculatedRisk += 0.3;
      if (predictedPH < 7.0 || predictedPH > 9.0) calculatedRisk += 0.3;

      riskScore = Number(Math.min(1.0, calculatedRisk).toFixed(2));
      riskLevel = this.computeRiskLevel(riskScore, predictedDO, predictedPH);
    }

    // Mốc thời gian dự báo là 2 giờ tiếp theo
    const predictedTime = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const predictionRecord = this.predictionRepo.create({
      pondId,
      predictionType: PredictionType.WATER_QUALITY,
      horizonHours: 2,
      predictedTime,
      predictedDO,
      predictedPH,
      predictedTemperature: currentTemp,
      riskScore,
      riskLevel,
      isFallback: !externalAiSuccess,
      predictionSource: externalAiSuccess ? SOURCE_AI_MICROSERVICE : SOURCE_HEURISTIC_RULE,
    });

    const savedPrediction = await this.predictionRepo.save(predictionRecord);
    this.logger.log(
      `[AI Prediction] Đã lưu bản ghi dự báo cho ao ${pondId}: DO=${predictedDO}, pH=${predictedPH}, RiskScore=${riskScore}, RiskLevel=${riskLevel}, Source=${predictionRecord.predictionSource}`,
    );

    return savedPrediction;
  }

  /**
   * Dự báo chất lượng nước đa khung giờ (12h - 24h) cho một ao nuôi (P2-1).
   * - Kiểm tra RBAC/tồn tại ao nuôi trước tiên
   * - Hỗ trợ cache 15 phút theo (pondId, WATER_QUALITY, horizonHours, stepHours)
   * - Tích hợp AI Microservice với kiểm tra contract và fallback heuristic thủy sản
   */
  async getWaterQualityForecast(
    pondId: string,
    query: QueryWaterQualityForecastDto,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<WaterQualityForecastResponseDto> {
    const pond = await this.findPondForPrediction(pondId, actorUserId, actorRole);

    const horizonHours = query.horizonHours ?? 24;
    const stepHours = query.stepHours ?? 1;
    const refresh = query.refresh === true;

    if (!refresh) {
      const cachedPrediction = await this.predictionRepo.findOne({
        where: {
          pondId,
          predictionType: PredictionType.WATER_QUALITY,
          horizonHours,
        },
        order: { createdAt: 'DESC' },
      });

      if (
        cachedPrediction &&
        this.isCacheFresh(cachedPrediction.createdAt) &&
        isWaterQualityCachePayload(cachedPrediction.payload, stepHours)
      ) {
        return this.hydrateWaterQualityForecast(cachedPrediction, cachedPrediction.payload, true);
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const { latest, history24h } = await this.collectPondTelemetry(pond, now);
    const pondProfile = await this.resolvePondProfile(pond, now);

    const currentMetrics: WaterQualityCurrentMetricsDto = {
      currentDO: asFiniteNumber(latest?.dissolvedOxygen) ?? null,
      currentPH: asFiniteNumber(latest?.ph) ?? null,
      currentTemp: asFiniteNumber(latest?.temperature) ?? null,
      salinity: asFiniteNumber(latest?.salinity) ?? null,
      turbidity: asFiniteNumber(latest?.turbidity) ?? null,
      recordedAt: latest?.recordedAt ? toIsoTimestamp(latest.recordedAt) : null,
    };

    const recentHistory = formatRecentHistory(history24h);

    let externalAiSuccess = false;
    let forecastResult: WaterQualityHeuristicOutput | null = null;

    const requestBuild = buildWaterQualityForecastRequest({
      pondId,
      horizonHours,
      stepHours,
      timestamp: nowIso,
      currentMetrics: {
        currentDO: currentMetrics.currentDO ?? undefined,
        currentPH: currentMetrics.currentPH ?? undefined,
        currentTemp: currentMetrics.currentTemp ?? undefined,
        salinity: currentMetrics.salinity ?? undefined,
        turbidity: currentMetrics.turbidity ?? undefined,
      },
      recentHistory,
      pondProfile,
    });

    if (requestBuild.ok) {
      const httpResult = await this.httpClient.predictWaterQuality(requestBuild.value);
      if (httpResult.ok) {
        const mapped = mapWaterQualityForecastResponse(httpResult.data);
        if (mapped.ok) {
          externalAiSuccess = true;
          forecastResult = {
            overallRiskScore: mapped.value.overallRiskScore,
            overallRiskLevel: mapped.value.overallRiskLevel,
            series: mapped.value.series,
            factors: mapped.value.factors,
            recommendations: mapped.value.recommendations,
          };
        } else {
          this.logger.warn(
            `[Water Quality Forecast Contract Warning] Phản hồi AI không hợp lệ cho ao ${pondId}: ${mapped.reason}. Sử dụng heuristic fallback.`,
          );
        }
      } else if (httpResult.category !== 'NOT_CONFIGURED') {
        this.logger.warn(
          `[Water Quality Forecast ${httpResult.category} Warning] Lỗi gọi AI cho ao ${pondId}: ${httpResult.message}. Sử dụng heuristic fallback.`,
        );
      }
    } else if (this.httpClient.resolveEndpointUrl('water-quality')) {
      this.logger.warn(
        `[Water Quality Forecast Request Warning] Bỏ qua gọi AI cho ao ${pondId}: ${requestBuild.reason}. Sử dụng heuristic fallback.`,
      );
    }

    if (!forecastResult) {
      forecastResult = this.buildHeuristicWaterQualityForecast(
        currentMetrics,
        horizonHours,
        stepHours,
        now,
        pondProfile,
      );
    }

    const { summary, peakPoint } = summarizeWaterQualitySeries(forecastResult.series);
    const predictedTime = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
    const predictedTimeIso = predictedTime.toISOString();
    const isFallback = !externalAiSuccess;
    const predictionSource = externalAiSuccess ? SOURCE_AI_MICROSERVICE : SOURCE_HEURISTIC_RULE;

    const packedPayload: Record<string, unknown> = {
      generatedAt: nowIso,
      predictedTime: predictedTimeIso,
      horizonHours,
      stepHours,
      riskScore: forecastResult.overallRiskScore,
      riskLevel: forecastResult.overallRiskLevel,
      currentMetrics,
      summary,
      series: forecastResult.series,
      factors: forecastResult.factors,
      recommendations: forecastResult.recommendations,
    };

    const record = this.predictionRepo.create({
      pondId,
      predictionType: PredictionType.WATER_QUALITY,
      horizonHours,
      predictedTime,
      predictedDO: summary.minDO,
      predictedPH: peakPoint.predictedPH,
      predictedTemperature: peakPoint.predictedTemperature,
      riskScore: forecastResult.overallRiskScore,
      riskLevel: forecastResult.overallRiskLevel,
      isFallback,
      predictionSource,
      payload: packedPayload,
    });

    const saved = await this.predictionRepo.save(record);

    return {
      predictionId: saved.predictionId,
      pondId,
      predictionType: PredictionType.WATER_QUALITY,
      generatedAt: nowIso,
      predictedTime: predictedTimeIso,
      horizonHours,
      stepHours,
      cached: false,
      isFallback,
      predictionSource,
      riskScore: forecastResult.overallRiskScore,
      riskLevel: forecastResult.overallRiskLevel,
      currentMetrics,
      summary,
      series: forecastResult.series,
      factors: forecastResult.factors,
      recommendations: forecastResult.recommendations,
    };
  }

  /**
   * Đánh giá rủi ro dịch bệnh (WSSV & AHPND/EMS) cho một ao nuôi (P2-1).
   * - Kiểm tra RBAC/tồn tại ao nuôi trước tiên
   * - Hỗ trợ cache 15 phút theo (pondId, DISEASE_RISK)
   * - Kết hợp telemetry, biến thiên 24h, manual test logs (NH3/NO2) và tuổi vụ nuôi (DoC)
   */
  async getDiseaseRiskAssessment(
    pondId: string,
    query: QueryDiseaseRiskDto,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<DiseaseRiskResponseDto> {
    const pond = await this.findPondForPrediction(pondId, actorUserId, actorRole);
    const refresh = query.refresh === true;

    if (!refresh) {
      const cachedPrediction = await this.predictionRepo.findOne({
        where: {
          pondId,
          predictionType: PredictionType.DISEASE_RISK,
        },
        order: { createdAt: 'DESC' },
      });

      if (
        cachedPrediction &&
        this.isCacheFresh(cachedPrediction.createdAt) &&
        isDiseaseRiskCachePayload(cachedPrediction.payload)
      ) {
        return this.hydrateDiseaseRiskAssessment(cachedPrediction, cachedPrediction.payload, true);
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const validUntilIso = validUntil.toISOString();

    const { latest, history24h } = await this.collectPondTelemetry(pond, now);
    const variability = computeVariability24h(latest, history24h);
    const latestManualLog = await this.resolveLatestManualTestLog(pond);
    const pondProfile = await this.resolvePondProfile(pond, now);

    const currentDO = asFiniteNumber(latest?.dissolvedOxygen) ?? null;
    const currentPH = asFiniteNumber(latest?.ph) ?? null;
    const currentTemp = asFiniteNumber(latest?.temperature) ?? null;
    const salinity = asFiniteNumber(latest?.salinity) ?? null;
    const turbidity = asFiniteNumber(latest?.turbidity) ?? null;
    const nh3 = asFiniteNumber(latestManualLog?.nh3Value) ?? null;
    const no2 = asFiniteNumber(latestManualLog?.no2Value) ?? null;

    const inputSnapshot: DiseaseRiskInputSnapshotDto = {
      currentDO,
      currentPH,
      currentTemp,
      salinity,
      turbidity,
      nh3,
      no2,
      temperatureDelta24h: variability.temperatureDelta,
      phDelta24h: variability.phDelta,
      minDO24h: variability.minDO,
      minTemp24h: variability.minTemp,
      maxTemp24h: variability.maxTemp,
      daysOfCulture: pondProfile.daysOfCulture ?? null,
      shrimpSpecies: pondProfile.shrimpSpecies ?? null,
      shrimpDensity: pondProfile.shrimpDensity ?? null,
    };

    let externalAiSuccess = false;
    let diseaseResult: DiseaseRiskHeuristicOutput | null = null;

    const requestBuild = buildDiseaseRiskRequest({
      pondId,
      timestamp: nowIso,
      currentMetrics: {
        currentDO: currentDO ?? undefined,
        currentPH: currentPH ?? undefined,
        currentTemp: currentTemp ?? undefined,
        salinity: salinity ?? undefined,
        turbidity: turbidity ?? undefined,
        nh3: nh3 ?? undefined,
        no2: no2 ?? undefined,
      },
      variability24h: {
        temperatureDelta: variability.temperatureDelta ?? undefined,
        phDelta: variability.phDelta ?? undefined,
        minDO: variability.minDO ?? undefined,
        minTemp: variability.minTemp ?? undefined,
        maxTemp: variability.maxTemp ?? undefined,
      },
      pondProfile,
    });

    if (requestBuild.ok) {
      const httpResult = await this.httpClient.predictDiseaseRisk(requestBuild.value);
      if (httpResult.ok) {
        const mapped = mapDiseaseRiskResponse(httpResult.data);
        if (mapped.ok) {
          externalAiSuccess = true;
          const topRecommendations =
            mapped.value.recommendations.length > 0
              ? mapped.value.recommendations
              : deduplicateStrings(mapped.value.diseases.flatMap((d) => d.recommendations));

          diseaseResult = {
            overallRiskScore: mapped.value.overallRiskScore,
            overallRiskLevel: mapped.value.overallRiskLevel,
            diseases: mapped.value.diseases,
            recommendations: topRecommendations,
          };
        } else {
          this.logger.warn(
            `[Disease Risk Contract Warning] Phản hồi AI không hợp lệ cho ao ${pondId}: ${mapped.reason}. Sử dụng heuristic fallback.`,
          );
        }
      } else if (httpResult.category !== 'NOT_CONFIGURED') {
        this.logger.warn(
          `[Disease Risk ${httpResult.category} Warning] Lỗi gọi AI cho ao ${pondId}: ${httpResult.message}. Sử dụng heuristic fallback.`,
        );
      }
    } else if (this.httpClient.resolveEndpointUrl('disease-risk')) {
      this.logger.warn(
        `[Disease Risk Request Warning] Bỏ qua gọi AI cho ao ${pondId}: ${requestBuild.reason}. Sử dụng heuristic fallback.`,
      );
    }

    if (!diseaseResult) {
      diseaseResult = this.buildHeuristicDiseaseRisk(inputSnapshot);
    }

    const isFallback = !externalAiSuccess;
    const predictionSource = externalAiSuccess ? SOURCE_AI_MICROSERVICE : SOURCE_HEURISTIC_RULE;

    const packedPayload: Record<string, unknown> = {
      assessedAt: nowIso,
      validUntil: validUntilIso,
      overallRiskScore: diseaseResult.overallRiskScore,
      overallRiskLevel: diseaseResult.overallRiskLevel,
      diseases: diseaseResult.diseases,
      inputSnapshot,
      recommendations: diseaseResult.recommendations,
    };

    const record = this.predictionRepo.create({
      pondId,
      predictionType: PredictionType.DISEASE_RISK,
      horizonHours: 24,
      predictedTime: validUntil,
      predictedDO: currentDO ?? DEFAULT_BASELINE_DO,
      predictedPH: currentPH ?? DEFAULT_BASELINE_PH,
      predictedTemperature: currentTemp ?? DEFAULT_BASELINE_TEMP,
      riskScore: diseaseResult.overallRiskScore,
      riskLevel: diseaseResult.overallRiskLevel,
      isFallback,
      predictionSource,
      payload: packedPayload,
    });

    const saved = await this.predictionRepo.save(record);

    return {
      predictionId: saved.predictionId,
      pondId,
      predictionType: PredictionType.DISEASE_RISK,
      assessedAt: nowIso,
      validUntil: validUntilIso,
      cached: false,
      isFallback,
      predictionSource,
      overallRiskScore: diseaseResult.overallRiskScore,
      overallRiskLevel: diseaseResult.overallRiskLevel,
      diseases: diseaseResult.diseases,
      inputSnapshot,
      recommendations: diseaseResult.recommendations,
    };
  }

  private computeRiskLevel(riskScore: number, predictedDO: number, predictedPH: number): RiskLevel {
    if (riskScore >= 0.7 || predictedDO < 3.0) {
      return RiskLevel.HIGH;
    }
    if (riskScore >= 0.4 || predictedDO < 4.5 || predictedPH < 7.2 || predictedPH > 8.8) {
      return RiskLevel.MEDIUM;
    }
    return RiskLevel.LOW;
  }

  /**
   * Lấy bản ghi dự báo chất lượng nước mới nhất của một ao nuôi
   */
  async getLatestPrediction(
    pondId: string,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<AiPrediction | null> {
    await this.assertPredictionReadAccess(pondId, actorUserId, actorRole);
    return this.predictionRepo.findOne({
      where: { pondId, predictionType: PredictionType.WATER_QUALITY },
      order: { predictedTime: 'DESC' },
    });
  }

  /**
   * Lấy lịch sử dự báo của một ao nuôi (hỗ trợ lọc tùy chọn theo predictionType)
   */
  async getPredictionHistory(
    pondId: string,
    limit = 20,
    actorUserId?: string,
    actorRole?: Role,
    predictionType?: PredictionType,
  ): Promise<AiPrediction[]> {
    await this.assertPredictionReadAccess(pondId, actorUserId, actorRole);
    return this.predictionRepo.find({
      where: predictionType ? { pondId, predictionType } : { pondId },
      order: { predictedTime: 'DESC' },
      take: limit,
    });
  }

  private async findPondForPrediction(
    pondId: string,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<Pond> {
    if (actorUserId && actorRole) {
      if (!this.pondsService) {
        throw new ServiceUnavailableException('Dịch vụ phân quyền ao nuôi chưa sẵn sàng');
      }
      return this.pondsService.findPondById(pondId, actorUserId, actorRole);
    }

    const pond = await this.pondRepo.findOne({
      where: { pondId },
      relations: ['devices'],
    });
    if (!pond) {
      throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${pondId}`);
    }
    return pond;
  }

  private async assertPredictionReadAccess(
    pondId: string,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<void> {
    if (actorUserId && actorRole) {
      if (!this.pondsService) {
        throw new ServiceUnavailableException('Dịch vụ phân quyền ao nuôi chưa sẵn sàng');
      }
      await this.pondsService.findPondById(pondId, actorUserId, actorRole);
    }
  }

  private getCacheTtlMinutes(): number {
    const raw = this.configService.get<string | number>('AI_PREDICTION_CACHE_TTL_MINUTES');
    const parsed = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_MINUTES;
  }

  private isCacheFresh(createdAt: Date | string | undefined | null): boolean {
    if (!createdAt) return false;
    const ttlMinutes = this.getCacheTtlMinutes();
    if (ttlMinutes <= 0) return false;

    const createdMs = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
    if (!Number.isFinite(createdMs)) return false;

    return Date.now() - createdMs < ttlMinutes * 60 * 1000;
  }

  private async collectPondTelemetry(pond: Pond, now: Date): Promise<PondTelemetryBundle> {
    const devices = Array.isArray(pond.devices) ? pond.devices : [];
    if (devices.length === 0 || !this.telemetryService) {
      return { latest: null, history24h: [] };
    }

    const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const endDate = now.toISOString();
    const latestCandidates: TelemetryData[] = [];
    const history24h: TelemetryData[] = [];

    for (const dev of devices) {
      if (typeof this.telemetryService.getLatestByDeviceId === 'function') {
        const latest = await this.telemetryService.getLatestByDeviceId(dev.deviceId);
        if (latest) {
          latestCandidates.push(latest);
        }
      }

      if (typeof this.telemetryService.getHistoryByDeviceId === 'function') {
        const historyResp = await this.telemetryService.getHistoryByDeviceId(dev.deviceId, {
          startDate,
          endDate,
          limit: 200,
          page: 1,
        });
        if (Array.isArray(historyResp?.data)) {
          history24h.push(...historyResp.data);
        }
      }
    }

    latestCandidates.sort((a, b) => toEpochMs(b.recordedAt) - toEpochMs(a.recordedAt));
    history24h.sort((a, b) => toEpochMs(a.recordedAt) - toEpochMs(b.recordedAt));

    const latest =
      latestCandidates[0] ?? (history24h.length > 0 ? history24h[history24h.length - 1] : null);

    return { latest, history24h };
  }

  private async resolveLatestManualTestLog(pond: Pond): Promise<ManualTestLog | null> {
    if (Array.isArray(pond.manualLogs) && pond.manualLogs.length > 0) {
      const sorted = [...pond.manualLogs].sort(
        (a, b) => toEpochMs(b.testedAt) - toEpochMs(a.testedAt),
      );
      return sorted[0] ?? null;
    }

    if (this.manualLogRepo && typeof this.manualLogRepo.findOne === 'function') {
      return this.manualLogRepo.findOne({
        where: { pondId: pond.pondId },
        order: { testedAt: 'DESC' },
      });
    }

    return null;
  }

  private async resolvePondProfile(pond: Pond, now: Date): Promise<PondProfileInput> {
    const profile: PondProfileInput = {};

    const areaM2 = asFiniteNumber(pond.areaM2);
    const depthM = asFiniteNumber(pond.depthM);
    const shrimpDensity = asFiniteNumber(pond.shrimpDensity);
    if (areaM2 !== undefined && areaM2 > 0) profile.areaM2 = areaM2;
    if (depthM !== undefined && depthM > 0) profile.depthM = depthM;
    if (shrimpDensity !== undefined && shrimpDensity > 0) profile.shrimpDensity = shrimpDensity;

    let activeBatch: ShrimpBatch | null = null;
    if (this.shrimpBatchRepo && typeof this.shrimpBatchRepo.findOne === 'function') {
      activeBatch = await this.shrimpBatchRepo.findOne({
        where: { pondId: pond.pondId, status: ShrimpBatchStatus.ACTIVE },
        order: { stockingDate: 'DESC', createdAt: 'DESC' },
      });
    } else if (Array.isArray(pond.shrimpBatches) && pond.shrimpBatches.length > 0) {
      const activeBatches = pond.shrimpBatches
        .filter((batch) => batch.status === ShrimpBatchStatus.ACTIVE)
        .sort((a, b) => Date.parse(String(b.stockingDate)) - Date.parse(String(a.stockingDate)));
      activeBatch = activeBatches[0] ?? null;
    }

    if (activeBatch) {
      if (typeof activeBatch.shrimpSpecies === 'string' && activeBatch.shrimpSpecies.trim()) {
        profile.shrimpSpecies = activeBatch.shrimpSpecies.trim();
      }
      const stockedMs = Date.parse(String(activeBatch.stockingDate));
      if (Number.isFinite(stockedMs)) {
        const diffDays = Math.floor((now.getTime() - stockedMs) / (24 * 60 * 60 * 1000));
        profile.daysOfCulture = Math.max(0, diffDays);
      }
    }

    return profile;
  }

  private buildHeuristicWaterQualityForecast(
    currentMetrics: WaterQualityCurrentMetricsDto,
    horizonHours: number,
    stepHours: number,
    now: Date,
    pondProfile: PondProfileInput,
  ): WaterQualityHeuristicOutput {
    const baseDO = currentMetrics.currentDO ?? DEFAULT_BASELINE_DO;
    const basePH = currentMetrics.currentPH ?? DEFAULT_BASELINE_PH;
    const baseTemp = currentMetrics.currentTemp ?? DEFAULT_BASELINE_TEMP;
    const hasLiveTelemetry =
      currentMetrics.currentDO !== null &&
      currentMetrics.currentPH !== null &&
      currentMetrics.currentTemp !== null;

    const hour0 = getSolarHour(now);
    const densityFactor =
      pondProfile.shrimpDensity !== undefined && pondProfile.shrimpDensity > 150 ? 0.15 : 0;
    const tempRespirationDrift = baseTemp > 30 ? -0.025 : -0.01;

    const offsets: number[] = [];
    for (let offset = stepHours; offset <= horizonHours; offset += stepHours) {
      offsets.push(offset);
    }
    if (offsets[offsets.length - 1] !== horizonHours) {
      offsets.push(horizonHours);
    }

    const series: WaterQualityForecastPointDto[] = offsets.map((offsetHours) => {
      const targetTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
      const targetHour = getSolarHour(targetTime);

      // Diurnal photosynthesis peaks around 16:00 and reaches pre-dawn trough around 04:00.
      const doPhaseDelta =
        0.75 *
        (Math.sin(((targetHour - 10) / 24) * 2 * Math.PI) -
          Math.sin(((hour0 - 10) / 24) * 2 * Math.PI));
      const respirationDrift = (tempRespirationDrift - densityFactor * 0.01) * offsetHours;
      const predictedDO = clampNumber(round2(baseDO + doPhaseDelta + respirationDrift), 0.5, 14.0);

      // Temperature follows daytime solar warming (peak ~15:00) and overnight cooling (~03:00).
      const tempPhaseDelta =
        1.2 *
        (Math.sin(((targetHour - 9) / 24) * 2 * Math.PI) -
          Math.sin(((hour0 - 9) / 24) * 2 * Math.PI));
      const predictedTemperature = clampNumber(round2(baseTemp + tempPhaseDelta), 15.0, 42.0);

      // pH rises during afternoon CO2 uptake and dips slightly before dawn.
      const phPhaseDelta =
        0.2 *
        (Math.sin(((targetHour - 9) / 24) * 2 * Math.PI) -
          Math.sin(((hour0 - 9) / 24) * 2 * Math.PI));
      const predictedPH = clampNumber(round2(basePH + phPhaseDelta), 5.5, 10.0);

      let pointScore = 0.1;
      if (predictedDO < 3.0) {
        pointScore += 0.55;
      } else if (predictedDO < 4.0) {
        pointScore += 0.35;
      } else if (predictedDO < 4.5) {
        pointScore += 0.15;
      }

      if (predictedPH < 6.8 || predictedPH > 9.0) {
        pointScore += 0.3;
      } else if (predictedPH < 7.2 || predictedPH > 8.8) {
        pointScore += 0.15;
      }

      if (predictedTemperature < 22.0 || predictedTemperature > 34.0) {
        pointScore += 0.25;
      } else if (predictedTemperature < 25.0 || predictedTemperature > 32.0) {
        pointScore += 0.1;
      }

      const riskScore = round2(clampNumber(pointScore, 0, 1));
      const riskLevel = this.computePointRiskLevel(riskScore, predictedDO, predictedPH, predictedTemperature);

      return {
        offsetHours,
        predictedTime: targetTime.toISOString(),
        predictedDO,
        predictedPH,
        predictedTemperature,
        riskScore,
        riskLevel,
      };
    });

    const { summary, peakPoint } = summarizeWaterQualitySeries(series);
    const factors: string[] = [];
    const recommendations: string[] = [];

    if (!hasLiveTelemetry) {
      factors.push('Thiếu dữ liệu cảm biến trực tiếp, sử dụng đường cơ sở ao nuôi chuẩn');
      recommendations.push('Kiểm tra kết nối cảm biến IoT để nâng cao độ chính xác dự báo');
    }
    if (summary.minDO < 4.0) {
      factors.push(`Oxy hòa tan dự báo giảm thấp về rạng sáng (${summary.minDO} mg/L)`);
      recommendations.push('Bật tăng cường quạt nước và sục khí đáy vào khung giờ 01:00 - 06:00');
    } else if (summary.minDO < 4.5) {
      factors.push(`Oxy hòa tan có xu hướng tiệm cận ngưỡng cảnh báo (${summary.minDO} mg/L)`);
      recommendations.push('Duy trì chạy quạt nước ổn định ban đêm để giữ DO >= 4.5 mg/L');
    }
    if (summary.minPH < 7.2 || summary.maxPH > 8.8) {
      factors.push(`Độ pH dao động ngoài vùng tối ưu (${summary.minPH} - ${summary.maxPH})`);
      recommendations.push('Kiểm tra độ kiềm và bổ sung vôi/mật rỉ đường để ổn định pH 7.5 - 8.5');
    }
    if (summary.maxTemperature > 32.0 || summary.minTemperature < 25.0) {
      factors.push(
        `Nhiệt độ nước dự báo biến động (${summary.minTemperature}°C - ${summary.maxTemperature}°C)`,
      );
      recommendations.push('Giữ mực nước ao tối thiểu 1.2 - 1.5m để giảm sốc nhiệt cho tôm');
    }
    if (factors.length === 0) {
      factors.push('Các thông số DO, pH và nhiệt độ dự báo duy trì ổn định trong ngưỡng an toàn');
    }
    if (recommendations.length === 0) {
      recommendations.push('Tiếp tục vận hành quy trình sục khí và cho ăn theo lịch chuẩn');
    }

    return {
      overallRiskScore: peakPoint.riskScore,
      overallRiskLevel: peakPoint.riskLevel,
      series,
      factors,
      recommendations,
    };
  }

  private computePointRiskLevel(
    riskScore: number,
    predictedDO: number,
    predictedPH: number,
    predictedTemperature: number,
  ): RiskLevel {
    if (riskScore >= 0.7 || predictedDO < 3.0) {
      return RiskLevel.HIGH;
    }
    if (
      riskScore >= 0.4 ||
      predictedDO < 4.5 ||
      predictedPH < 7.2 ||
      predictedPH > 8.8 ||
      predictedTemperature > 34.0 ||
      predictedTemperature < 22.0
    ) {
      return RiskLevel.MEDIUM;
    }
    return RiskLevel.LOW;
  }

  private buildHeuristicDiseaseRisk(
    snapshot: DiseaseRiskInputSnapshotDto,
  ): DiseaseRiskHeuristicOutput {
    const temp = snapshot.currentTemp ?? DEFAULT_BASELINE_TEMP;
    const ph = snapshot.currentPH ?? DEFAULT_BASELINE_PH;
    const doVal = snapshot.currentDO ?? DEFAULT_BASELINE_DO;
    const salinity = snapshot.salinity;
    const turbidity = snapshot.turbidity;
    const nh3 = snapshot.nh3;
    const no2 = snapshot.no2;
    const tempDelta = snapshot.temperatureDelta24h;
    const phDelta = snapshot.phDelta24h;
    const minDO24h = snapshot.minDO24h;
    const minTemp24h = snapshot.minTemp24h;
    const doc = snapshot.daysOfCulture;

    // 1. WSSV (White Spot Syndrome Virus) heuristic
    let wssvScore = 0.1;
    const wssvIndicators: string[] = [];
    const wssvRecommendations: string[] = [];

    if (temp < 25.0 || (minTemp24h !== null && minTemp24h < 25.0)) {
      wssvScore += 0.3;
      wssvIndicators.push('Nhiệt độ nước xuống thấp (< 25°C) làm tăng mạnh nguy cơ bùng phát WSSV');
    } else if (temp < 27.0) {
      wssvScore += 0.15;
      wssvIndicators.push(`Nhiệt độ nước hơi thấp (${temp}°C), cần theo dõi dấu hiệu đốm trắng`);
    }

    if (tempDelta !== null && tempDelta >= 3.5) {
      wssvScore += 0.3;
      wssvIndicators.push(`Biến thiên nhiệt độ 24h lớn (${tempDelta}°C) gây sốc nhiệt`);
    } else if (tempDelta !== null && tempDelta >= 2.0) {
      wssvScore += 0.15;
      wssvIndicators.push(`Nhiệt độ 24h dao động ${tempDelta}°C`);
    }

    if (doVal < 3.5 || (minDO24h !== null && minDO24h < 3.5)) {
      wssvScore += 0.25;
      wssvIndicators.push('Oxy hòa tan thấp (< 3.5 mg/L) làm suy giảm miễn dịch tôm');
    } else if (doVal < 4.5 || (minDO24h !== null && minDO24h < 4.5)) {
      wssvScore += 0.12;
      wssvIndicators.push('Oxy hòa tan dưới mức tối ưu (< 4.5 mg/L)');
    }

    if (phDelta !== null && phDelta >= 0.6) {
      wssvScore += 0.15;
      wssvIndicators.push(`Dao động pH 24h cao (${phDelta})`);
    }
    if (salinity !== null && (salinity < 5 || salinity > 35)) {
      wssvScore += 0.1;
      wssvIndicators.push(`Độ mặn ngoài ngưỡng ổn định (${salinity} ppt)`);
    }

    wssvScore = round2(clampNumber(wssvScore, 0, 1));
    const wssvLevel = scoreToRiskLevel(wssvScore);

    if (wssvIndicators.length === 0) {
      wssvIndicators.push('Nhiệt độ và biến động môi trường 24h chưa ghi nhận yếu tố kích hoạt WSSV');
    }
    if (wssvLevel !== RiskLevel.LOW) {
      wssvRecommendations.push('Ổn định mực nước ao >= 1.2 - 1.5m và tránh thay nước đột ngột khi trời lạnh');
      wssvRecommendations.push('Bổ sung Vitamin C, khoáng chất và beta-glucan vào khẩu phần ăn để tăng đề kháng');
      if (wssvLevel === RiskLevel.HIGH) {
        wssvRecommendations.push('Lấy mẫu tôm kiểm tra PCR WSSV ngay nếu phát hiện tôm giảm ăn hoặc dạt bờ');
      }
    } else {
      wssvRecommendations.push('Duy trì an toàn sinh học, kiểm soát chim/giáp xác mang mầm bệnh xâm nhập ao');
    }

    // 2. AHPND_EMS (Acute Hepatopancreatic Necrosis Disease) heuristic
    let ahpndScore = 0.1;
    const ahpndIndicators: string[] = [];
    const ahpndRecommendations: string[] = [];

    if (ph > 8.8 || ph < 6.8) {
      ahpndScore += 0.25;
      ahpndIndicators.push(`Độ pH bất thường (${ph}) tạo điều kiện cho vi khuẩn Vibrio phát triển`);
    } else if (ph > 8.4 || ph < 7.2) {
      ahpndScore += 0.12;
      ahpndIndicators.push(`Độ pH tiệm cận ngưỡng nhạy cảm (${ph})`);
    }

    if (phDelta !== null && phDelta >= 0.6) {
      ahpndScore += 0.2;
      ahpndIndicators.push(`Biến thiên pH ngày/đêm cao (${phDelta}) gây stress gan tụy tôm`);
    } else if (phDelta !== null && phDelta >= 0.4) {
      ahpndScore += 0.1;
      ahpndIndicators.push(`Dao động pH 24h mức trung bình (${phDelta})`);
    }

    if (temp > 32.0) {
      ahpndScore += 0.2;
      ahpndIndicators.push(`Nhiệt độ nước cao (${temp}°C) thúc đẩy mật độ Vibrio parahaemolyticus`);
    } else if (temp > 30.0) {
      ahpndScore += 0.1;
      ahpndIndicators.push(`Nhiệt độ nước ấm (${temp}°C) thuận lợi cho vi khuẩn cơ hội`);
    }

    if (nh3 !== null && nh3 >= 0.1) {
      ahpndScore += 0.3;
      ahpndIndicators.push(`Khí độc NH3 vượt ngưỡng nguy hiểm (${nh3} mg/L)`);
    } else if (nh3 !== null && nh3 >= 0.05) {
      ahpndScore += 0.18;
      ahpndIndicators.push(`Khí độc NH3 tăng cao (${nh3} mg/L)`);
    }

    if (no2 !== null && no2 >= 1.0) {
      ahpndScore += 0.2;
      ahpndIndicators.push(`Khí độc NO2 cao (${no2} mg/L) gây suy yếu gan tụy`);
    } else if (no2 !== null && no2 >= 0.5) {
      ahpndScore += 0.1;
      ahpndIndicators.push(`Nồng độ NO2 cần lưu ý (${no2} mg/L)`);
    }

    if (salinity !== null && salinity > 25) {
      ahpndScore += 0.1;
      ahpndIndicators.push(`Độ mặn cao (${salinity} ppt) làm tăng áp lực Vibrio`);
    }
    if (turbidity !== null && turbidity > 50) {
      ahpndScore += 0.1;
      ahpndIndicators.push(`Độ đục cao (${turbidity} NTU) phản ánh tải lượng hữu cơ đáy ao lớn`);
    }
    if (doc !== null && doc >= 5 && doc <= 45 && ahpndScore > 0.15) {
      ahpndScore += 0.08;
      ahpndIndicators.push(`Tôm đang ở giai đoạn ngày tuổi nhạy cảm AHPND (${doc} ngày tuổi)`);
    }

    ahpndScore = round2(clampNumber(ahpndScore, 0, 1));
    const ahpndLevel = scoreToRiskLevel(ahpndScore);

    if (ahpndIndicators.length === 0) {
      ahpndIndicators.push('Các chỉ số pH, NH3/NO2 và độ đục chưa ghi nhận yếu tố bất lợi gây AHPND/EMS');
    }
    if (ahpndLevel !== RiskLevel.LOW) {
      ahpndRecommendations.push('Tạt chế phẩm sinh học Bacillus spp. để cạnh tranh và ức chế vi khuẩn Vibrio');
      ahpndRecommendations.push('Giảm 20 - 30% lượng thức ăn, tăng cường xi-phông đáy ao loại bỏ chất hữu cơ dư thừa');
      if (nh3 !== null && nh3 >= 0.05) {
        ahpndRecommendations.push('Đánh Yucca hoặc thay nước từng phần kết hợp sục khí mạnh để hạ NH3/NO2');
      }
    } else {
      ahpndRecommendations.push('Duy trì định kỳ men vi sinh đường ruột và kiểm soát pH sáng/chiều ổn định');
    }

    const diseases: DiseaseRiskItemDto[] = [
      {
        diseaseCode: 'WSSV',
        diseaseName: 'Bệnh đốm trắng (WSSV)',
        riskScore: wssvScore,
        riskLevel: wssvLevel,
        indicators: wssvIndicators,
        recommendations: wssvRecommendations,
      },
      {
        diseaseCode: 'AHPND_EMS',
        diseaseName: 'Bệnh hoại tử gan tụy cấp (AHPND/EMS)',
        riskScore: ahpndScore,
        riskLevel: ahpndLevel,
        indicators: ahpndIndicators,
        recommendations: ahpndRecommendations,
      },
    ];

    const overallRiskScore = round2(Math.max(wssvScore, ahpndScore));
    const overallRiskLevel = scoreToRiskLevel(overallRiskScore);
    const recommendations = deduplicateStrings([
      ...wssvRecommendations,
      ...ahpndRecommendations,
    ]);

    return {
      overallRiskScore,
      overallRiskLevel,
      diseases,
      recommendations,
    };
  }

  private hydrateWaterQualityForecast(
    prediction: AiPrediction,
    payload: WaterQualityCachePayload,
    cached: boolean,
  ): WaterQualityForecastResponseDto {
    return {
      predictionId: prediction.predictionId,
      pondId: prediction.pondId,
      predictionType: PredictionType.WATER_QUALITY,
      generatedAt: payload.generatedAt,
      predictedTime: payload.predictedTime,
      horizonHours: payload.horizonHours,
      stepHours: payload.stepHours,
      cached,
      isFallback: prediction.isFallback,
      predictionSource: prediction.predictionSource,
      riskScore: payload.riskScore,
      riskLevel: payload.riskLevel,
      currentMetrics: payload.currentMetrics,
      summary: payload.summary,
      series: payload.series,
      factors: payload.factors,
      recommendations: payload.recommendations,
    };
  }

  private hydrateDiseaseRiskAssessment(
    prediction: AiPrediction,
    payload: DiseaseRiskCachePayload,
    cached: boolean,
  ): DiseaseRiskResponseDto {
    return {
      predictionId: prediction.predictionId,
      pondId: prediction.pondId,
      predictionType: PredictionType.DISEASE_RISK,
      assessedAt: payload.assessedAt,
      validUntil: payload.validUntil,
      cached,
      isFallback: prediction.isFallback,
      predictionSource: prediction.predictionSource,
      overallRiskScore: payload.overallRiskScore,
      overallRiskLevel: payload.overallRiskLevel,
      diseases: payload.diseases,
      inputSnapshot: payload.inputSnapshot,
      recommendations: payload.recommendations,
    };
  }
}

interface WaterQualityCachePayload {
  generatedAt: string;
  predictedTime: string;
  horizonHours: number;
  stepHours: number;
  riskScore: number;
  riskLevel: RiskLevel;
  currentMetrics: WaterQualityCurrentMetricsDto;
  summary: WaterQualityForecastSummaryDto;
  series: WaterQualityForecastPointDto[];
  factors: string[];
  recommendations: string[];
}

interface DiseaseRiskCachePayload {
  assessedAt: string;
  validUntil: string;
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  diseases: DiseaseRiskItemDto[];
  inputSnapshot: DiseaseRiskInputSnapshotDto;
  recommendations: string[];
}

function isWaterQualityCachePayload(
  payload: unknown,
  expectedStepHours: number,
): payload is WaterQualityCachePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.stepHours === expectedStepHours &&
    Array.isArray(record.series) &&
    record.series.length > 0 &&
    typeof record.summary === 'object' &&
    record.summary !== null &&
    typeof record.currentMetrics === 'object' &&
    record.currentMetrics !== null
  );
}

function isDiseaseRiskCachePayload(payload: unknown): payload is DiseaseRiskCachePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    Array.isArray(record.diseases) &&
    record.diseases.length >= 2 &&
    typeof record.inputSnapshot === 'object' &&
    record.inputSnapshot !== null
  );
}

function summarizeWaterQualitySeries(series: WaterQualityForecastPointDto[]): {
  summary: WaterQualityForecastSummaryDto;
  peakPoint: WaterQualityForecastPointDto;
} {
  let peakPoint = series[0];
  let sumDO = 0;
  let minDO = series[0].predictedDO;
  let maxDO = series[0].predictedDO;
  let minPH = series[0].predictedPH;
  let maxPH = series[0].predictedPH;
  let minTemp = series[0].predictedTemperature;
  let maxTemp = series[0].predictedTemperature;

  for (const point of series) {
    sumDO += point.predictedDO;
    if (point.predictedDO < minDO) minDO = point.predictedDO;
    if (point.predictedDO > maxDO) maxDO = point.predictedDO;
    if (point.predictedPH < minPH) minPH = point.predictedPH;
    if (point.predictedPH > maxPH) maxPH = point.predictedPH;
    if (point.predictedTemperature < minTemp) minTemp = point.predictedTemperature;
    if (point.predictedTemperature > maxTemp) maxTemp = point.predictedTemperature;
    if (point.riskScore > peakPoint.riskScore) {
      peakPoint = point;
    }
  }

  return {
    peakPoint,
    summary: {
      minDO: round2(minDO),
      maxDO: round2(maxDO),
      avgDO: round2(sumDO / series.length),
      minPH: round2(minPH),
      maxPH: round2(maxPH),
      minTemperature: round2(minTemp),
      maxTemperature: round2(maxTemp),
      peakRiskScore: peakPoint.riskScore,
      peakRiskOffsetHours: peakPoint.offsetHours,
      peakRiskTime: peakPoint.predictedTime,
    },
  };
}

function formatRecentHistory(history: TelemetryData[]): WaterQualityHistoryPoint[] {
  if (history.length === 0) return [];

  const maxPoints = 48;
  const stride = history.length > maxPoints ? Math.ceil(history.length / maxPoints) : 1;
  const result: WaterQualityHistoryPoint[] = [];

  for (let i = 0; i < history.length; i += stride) {
    const row = history[i];
    const recordedAt = toIsoTimestamp(row.recordedAt);
    if (!recordedAt) continue;

    const point: WaterQualityHistoryPoint = { recordedAt };
    const dissolvedOxygen = asFiniteNumber(row.dissolvedOxygen);
    const ph = asFiniteNumber(row.ph);
    const temperature = asFiniteNumber(row.temperature);
    const salinity = asFiniteNumber(row.salinity);
    const turbidity = asFiniteNumber(row.turbidity);

    if (dissolvedOxygen !== undefined) point.dissolvedOxygen = dissolvedOxygen;
    if (ph !== undefined) point.ph = ph;
    if (temperature !== undefined) point.temperature = temperature;
    if (salinity !== undefined) point.salinity = salinity;
    if (turbidity !== undefined) point.turbidity = turbidity;

    if (
      dissolvedOxygen !== undefined ||
      ph !== undefined ||
      temperature !== undefined ||
      salinity !== undefined ||
      turbidity !== undefined
    ) {
      result.push(point);
    }
  }

  return result;
}

function computeVariability24h(
  latest: TelemetryData | null,
  history24h: TelemetryData[],
): Variability24hMetrics {
  const samples = history24h.length > 0 ? [...history24h] : [];
  if (latest && samples.length > 0) {
    samples.push(latest);
  }

  if (samples.length === 0) {
    const singleDO = asFiniteNumber(latest?.dissolvedOxygen) ?? null;
    const singleTemp = asFiniteNumber(latest?.temperature) ?? null;
    return {
      temperatureDelta: null,
      phDelta: null,
      minDO: singleDO,
      minTemp: singleTemp,
      maxTemp: singleTemp,
    };
  }

  const temps = samples
    .map((item) => asFiniteNumber(item.temperature))
    .filter((value): value is number => value !== undefined);
  const phs = samples
    .map((item) => asFiniteNumber(item.ph))
    .filter((value): value is number => value !== undefined);
  const dos = samples
    .map((item) => asFiniteNumber(item.dissolvedOxygen))
    .filter((value): value is number => value !== undefined);

  const minTemp = temps.length > 0 ? round2(Math.min(...temps)) : null;
  const maxTemp = temps.length > 0 ? round2(Math.max(...temps)) : null;
  const temperatureDelta =
    minTemp !== null && maxTemp !== null ? round2(maxTemp - minTemp) : null;
  const phDelta =
    phs.length > 0 ? round2(Math.max(...phs) - Math.min(...phs)) : null;
  const minDO = dos.length > 0 ? round2(Math.min(...dos)) : null;

  return {
    temperatureDelta,
    phDelta,
    minDO,
    minTemp,
    maxTemp,
  };
}

function asFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toEpochMs(value: Date | string | undefined | null): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function toIsoTimestamp(value: Date | string | undefined | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function getSolarHour(date: Date): number {
  // Use Vietnam solar local time (UTC+7) so diurnal photosynthesis/respiration peaks align with local aquaculture ponds.
  const vnMinutes = (date.getUTCHours() + 7) * 60 + date.getUTCMinutes();
  return (vnMinutes / 60) % 24;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 0.7) return RiskLevel.HIGH;
  if (score >= 0.4) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}

function deduplicateStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}
