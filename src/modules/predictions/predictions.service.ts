import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AiPrediction } from './entities/ai-prediction.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { PondsService } from '../ponds/ponds.service.js';
import { Role } from '../../common/enums/role.enum.js';
import {
  AI_PREDICTION_CONTRACT_VERSION,
  buildAiPredictionRequest,
  mapAiPredictionResponse,
} from './contracts/ai-prediction.mapper.js';

export interface PredictionExecutionContext {
  triggerSource: 'manual-pond-trigger' | 'scheduled' | 'manual-active' | 'direct';
  correlationId?: string;
  jobId?: string;
}

type PredictionTelemetry = {
  dissolvedOxygen: number;
  ph: number;
  temperature: number;
  salinity: number;
  turbidity: number;
  recordedAt: Date;
};

type UnknownTelemetrySample = {
  recordedAt: unknown;
  dissolvedOxygen: unknown;
  ph: unknown;
  temperature: unknown;
  salinity: unknown;
  turbidity: unknown;
};

type PredictionTelemetryErrorCode =
  | 'PREDICTION_TELEMETRY_MISSING'
  | 'PREDICTION_TELEMETRY_INVALID'
  | 'PREDICTION_TELEMETRY_STALE'
  | 'PREDICTION_TELEMETRY_FUTURE';

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);

  constructor(
    @InjectRepository(AiPrediction)
    private readonly predictionRepo: Repository<AiPrediction>,
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
    private readonly configService: ConfigService,
    private readonly telemetryService?: TelemetryService,
    @Optional()
    private readonly pondsService?: PondsService,
  ) {}

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
   * Kích hoạt dự báo chất lượng nước và đánh giá rủi ro cho một ao nuôi:
   * 1. Kiểm tra ao nuôi
   * 2. Lấy chỉ số cảm biến gần nhất từ TelemetryService (nếu có thiết bị gán vào ao)
   * 3. Gọi AI Model Service ngoại vi hoặc sử dụng mô hình nội bộ để tính toán DO, pH, Risk
   * 4. Lưu bản ghi kết quả vào bảng ai_prediction
   */
  async predictForPond(
    pondId: string,
    actorUserId?: string,
    actorRole?: Role,
    executionContext: PredictionExecutionContext = { triggerSource: 'direct' },
  ): Promise<AiPrediction> {
    const pond = await this.findPondForPrediction(pondId, actorUserId, actorRole);

    if (!pond) {
      throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${pondId}`);
    }

    const correlationId = executionContext.correlationId ?? randomUUID();
    // Một dự báo phải dựa trên một mẫu cảm biến hoàn chỉnh, còn mới; không
    // thay bằng giá trị danh nghĩa để biến telemetry thiếu thành kết quả giả.
    const telemetry = await this.getFreshPredictionTelemetry(pond);
    const currentDO = telemetry.dissolvedOxygen;
    const currentPH = telemetry.ph;
    const currentTemp = telemetry.temperature;
    const salinity = telemetry.salinity;
    const turbidity = telemetry.turbidity;

    const aiApiUrl = this.configService.get<string>('AI_PREDICTION_API_URL');
    let predictedDO = currentDO;
    let predictedPH = currentPH;
    let riskScore = 0.1;
    let riskLevel: RiskLevel = RiskLevel.LOW;

    // Thử gọi AI Microservice nếu có cấu hình (kèm Timeout 10s để không làm treo worker)
    let externalAiSuccess = false;
    const contractVersion = this.configService.get<string>('AI_PREDICTION_CONTRACT_VERSION')
      ?? AI_PREDICTION_CONTRACT_VERSION;
    const aiRequest = buildAiPredictionRequest({
      pondId,
      currentDO,
      currentPH,
      currentTemp,
      timestamp: telemetry.recordedAt.toISOString(),
      salinity,
      turbidity,
    }, contractVersion);

    if (!aiRequest.ok) {
      throw this.predictionUnavailable(
        'PREDICTION_TELEMETRY_INVALID',
        `Không thể lập payload dự báo từ telemetry: ${aiRequest.reason}`,
      );
    }

    const aiProductionApproved = this.configService.get<string>('AI_PRODUCTION_INFERENCE_APPROVED') === 'true';
    if (aiApiUrl && aiProductionApproved) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(aiApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': correlationId,
          },
          body: JSON.stringify(aiRequest.value),
          signal: controller.signal,
        });
        if (response.ok) {
          const mapped = mapAiPredictionResponse(await response.json());
          if (mapped.ok) {
            predictedDO = mapped.value.predictedDO;
            predictedPH = mapped.value.predictedPH;
            riskScore = mapped.value.riskScore;
            riskLevel = mapped.value.riskLevel;
            externalAiSuccess = true;
            this.logger.log(JSON.stringify({ event: 'ai_prediction_response', pondId, correlationId, source: executionContext.triggerSource, jobId: executionContext.jobId, outcome: 'ai_success' }));
          } else {
            this.logger.warn(`[AI Prediction Contract Warning] Phản hồi AI không hợp lệ cho ao ${pondId}: ${mapped.reason}. Sử dụng mô hình ước tính tích hợp.`);
          }
        } else {
          this.logger.warn(JSON.stringify({ event: 'ai_prediction_response', pondId, correlationId, source: executionContext.triggerSource, jobId: executionContext.jobId, outcome: 'fallback_http_non_success', status: response.status }));
        }
      } catch (err: any) {
        const category = err?.name === 'AbortError'
          ? 'Timeout'
          : 'Transport';
        this.logger.warn(JSON.stringify({ event: 'ai_prediction_response', pondId, correlationId, source: executionContext.triggerSource, jobId: executionContext.jobId, outcome: `fallback_${category.toLowerCase()}` }));
      } finally {
        clearTimeout(timeoutId);
      }
    } else if (aiApiUrl && !aiProductionApproved) {
      this.logger.warn(
        `[AI Prediction Blocked] Không gọi AI cho ao ${pondId}: AI_PRODUCTION_INFERENCE_APPROVED chưa được phê duyệt. Sử dụng HEURISTIC_RULE với telemetry hợp lệ.`,
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
      predictedTime,
      predictedDO,
      predictedPH,
      riskScore,
      riskLevel,
      isFallback: !externalAiSuccess,
      predictionSource: externalAiSuccess ? 'AI_MICROSERVICE' : 'HEURISTIC_RULE',
    });

    const savedPrediction = await this.predictionRepo.save(predictionRecord);
    this.logger.log(JSON.stringify({ event: 'prediction_persisted', pondId, correlationId, source: executionContext.triggerSource, jobId: executionContext.jobId, predictionSource: predictionRecord.predictionSource, isFallback: predictionRecord.isFallback, telemetryRecordedAt: telemetry.recordedAt.toISOString() }));

    return savedPrediction;
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

  private async getFreshPredictionTelemetry(pond: Pond): Promise<PredictionTelemetry> {
    if (!this.telemetryService || !pond.devices?.length) {
      throw this.predictionUnavailable(
        'PREDICTION_TELEMETRY_MISSING',
        'Ao nuôi chưa có thiết bị hoặc dịch vụ telemetry chưa sẵn sàng',
      );
    }

    const timestampedSamples: Array<{ sample: UnknownTelemetrySample; recordedAt: Date }> = [];
    let invalidTimestampFound = false;

    for (const device of pond.devices) {
      const latest = await this.telemetryService.getLatestByDeviceId(device.deviceId);
      if (!latest) continue;

      const sample = latest as unknown as UnknownTelemetrySample;
      const recordedAt = toValidDate(sample.recordedAt);
      if (!recordedAt) {
        invalidTimestampFound = true;
        continue;
      }
      timestampedSamples.push({ sample, recordedAt });
    }

    if (!timestampedSamples.length) {
      throw this.predictionUnavailable(
        invalidTimestampFound ? 'PREDICTION_TELEMETRY_INVALID' : 'PREDICTION_TELEMETRY_MISSING',
        invalidTimestampFound
          ? 'Telemetry không có recordedAt hợp lệ'
          : 'Không tìm thấy telemetry cho các thiết bị của ao',
      );
    }

    timestampedSamples.sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime());
    const latest = timestampedSamples[0];
    const now = Date.now();
    const ageMs = now - latest.recordedAt.getTime();
    if (ageMs < 0) {
      throw this.predictionUnavailable(
        'PREDICTION_TELEMETRY_FUTURE',
        'Telemetry có recordedAt nằm trong tương lai',
      );
    }

    const maxAgeMs = this.getPredictionTelemetryMaxAgeMinutes() * 60 * 1000;
    if (ageMs > maxAgeMs) {
      throw this.predictionUnavailable(
        'PREDICTION_TELEMETRY_STALE',
        `Telemetry không còn mới (đã quá thời hạn ${this.getPredictionTelemetryMaxAgeMinutes()} phút)`,
      );
    }

    const dissolvedOxygen = asFiniteNumber(latest.sample.dissolvedOxygen);
    const ph = asFiniteNumber(latest.sample.ph);
    const temperature = asFiniteNumber(latest.sample.temperature);
    const salinity = asFiniteNumber(latest.sample.salinity);
    const turbidity = asFiniteNumber(latest.sample.turbidity);
    if (
      dissolvedOxygen === undefined
      || ph === undefined
      || temperature === undefined
      || salinity === undefined
      || turbidity === undefined
    ) {
      throw this.predictionUnavailable(
        'PREDICTION_TELEMETRY_INVALID',
        'Telemetry phải có dissolvedOxygen, ph, temperature, salinity và turbidity là số hữu hạn',
      );
    }

    return { dissolvedOxygen, ph, temperature, salinity, turbidity, recordedAt: latest.recordedAt };
  }

  private getPredictionTelemetryMaxAgeMinutes(): number {
    const configured = Number(
      this.configService.get<string>('PREDICTION_TELEMETRY_MAX_AGE_MINUTES')
      ?? this.configService.get<string>('DEVICE_STALE_TIMEOUT_MINUTES')
      ?? '15',
    );
    return Number.isFinite(configured) && configured > 0 ? configured : 15;
  }

  private predictionUnavailable(code: PredictionTelemetryErrorCode, message: string): ServiceUnavailableException {
    return new ServiceUnavailableException({ errorCode: code, message });
  }

  /**
   * Lấy bản ghi dự báo mới nhất của một ao nuôi
   */
  async getLatestPrediction(
    pondId: string,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<AiPrediction | null> {
    await this.assertPredictionReadAccess(pondId, actorUserId, actorRole);
    return this.predictionRepo.findOne({
      where: { pondId },
      order: { predictedTime: 'DESC' },
    });
  }

  /**
   * Lấy lịch sử dự báo của một ao nuôi
   */
  async getPredictionHistory(
    pondId: string,
    limit = 20,
    actorUserId?: string,
    actorRole?: Role,
  ): Promise<AiPrediction[]> {
    await this.assertPredictionReadAccess(pondId, actorUserId, actorRole);
    return this.predictionRepo.find({
      where: { pondId },
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
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toValidDate(value: unknown): Date | undefined {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return undefined;
  return value;
}
