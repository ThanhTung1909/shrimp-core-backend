import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AiPrediction } from './entities/ai-prediction.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

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
  async predictForPond(pondId: string): Promise<AiPrediction> {
    const pond = await this.pondRepo.findOne({
      where: { pondId },
      relations: ['devices'],
    });

    if (!pond) {
      throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${pondId}`);
    }

    // Lấy số liệu cảm biến mới nhất từ thiết bị của ao (nếu có)
    let currentDO = 5.5;
    let currentPH = 7.8;
    let currentTemp = 28.0;

    if (pond.devices && pond.devices.length > 0 && this.telemetryService) {
      for (const dev of pond.devices) {
        const latestTelemetry = await this.telemetryService.getLatestByDeviceId(dev.deviceId);
        if (latestTelemetry) {
          if (latestTelemetry.dissolvedOxygen !== null) currentDO = Number(latestTelemetry.dissolvedOxygen);
          if (latestTelemetry.ph !== null) currentPH = Number(latestTelemetry.ph);
          if (latestTelemetry.temperature !== null) currentTemp = Number(latestTelemetry.temperature);
          break;
        }
      }
    }

    const aiApiUrl = this.configService.get<string>('AI_PREDICTION_API_URL');
    let predictedDO = currentDO;
    let predictedPH = currentPH;
    let riskScore = 0.1;
    let riskLevel: RiskLevel = RiskLevel.LOW;

    // Thử gọi AI Microservice nếu có cấu hình
    let externalAiSuccess = false;
    if (aiApiUrl) {
      try {
        const response = await fetch(aiApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pondId,
            currentDO,
            currentPH,
            currentTemp,
            timestamp: new Date().toISOString(),
          }),
        });
        if (response.ok) {
          const result = await response.json();
          predictedDO = Number(result.predictedDO ?? currentDO);
          predictedPH = Number(result.predictedPH ?? currentPH);
          riskScore = Number(result.riskScore ?? 0.1);
          riskLevel = (result.riskLevel as RiskLevel) || this.computeRiskLevel(riskScore, predictedDO, predictedPH);
          externalAiSuccess = true;
          this.logger.log(`[AI Prediction] Nhận kết quả từ AI Microservice cho ao ${pondId}`);
        }
      } catch (err: any) {
        this.logger.warn(`[AI Prediction Warning] Không thể kết nối AI Microservice: ${err.message}. Sử dụng mô hình ước tính tích hợp.`);
      }
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
    });

    const savedPrediction = await this.predictionRepo.save(predictionRecord);
    this.logger.log(
      `[AI Prediction] Đã lưu bản ghi dự báo cho ao ${pondId}: DO=${predictedDO}, pH=${predictedPH}, RiskScore=${riskScore}, RiskLevel=${riskLevel}`,
    );

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

  /**
   * Lấy bản ghi dự báo mới nhất của một ao nuôi
   */
  async getLatestPrediction(pondId: string): Promise<AiPrediction | null> {
    return this.predictionRepo.findOne({
      where: { pondId },
      order: { predictedTime: 'DESC' },
    });
  }

  /**
   * Lấy lịch sử dự báo của một ao nuôi
   */
  async getPredictionHistory(pondId: string, limit = 20): Promise<AiPrediction[]> {
    return this.predictionRepo.find({
      where: { pondId },
      order: { predictedTime: 'DESC' },
      take: limit,
    });
  }
}
