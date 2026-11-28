import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PredictionsService } from './predictions.service.js';
import { AiPredictionHttpClient } from './clients/ai-prediction-http.client.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { PredictionType } from '../../common/enums/prediction-type.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { ShrimpBatchStatus } from '../../common/enums/shrimp-batch-status.enum.js';

describe('PredictionsService', () => {
  const pondId = '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb';
  let service: PredictionsService;
  let mockPredictionRepo: any;
  let mockPondRepo: any;
  let mockConfigService: any;
  let mockTelemetryService: any;
  let mockPondsService: any;

  beforeEach(() => {
    mockPredictionRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ predictionId: 'pred-1', ...data })),
      findOne: vi.fn(),
      find: vi.fn(),
    };

    mockPondRepo = {
      find: vi.fn().mockResolvedValue([{ pondId }, { pondId: 'cbd3a63d-4308-4de1-b7e1-d9c8e3d3bbf5' }]),
      findOne: vi.fn().mockResolvedValue({
        pondId,
        devices: [{ deviceId: 'dev-1' }],
      }),
    };

    mockConfigService = {
      get: vi.fn((key) => {
        if (key === 'AI_PREDICTION_API_URL') return 'http://ai-service:8000/predict';
        if (key === 'AI_PREDICTION_CONTRACT_VERSION') return 'ai-develop-v1';
        if (key === 'AI_PRODUCTION_INFERENCE_APPROVED') return 'true';
        if (key === 'PREDICTION_TELEMETRY_MAX_AGE_MINUTES') return '15';
        return null;
      }),
    };

    mockTelemetryService = {
      getLatestByDeviceId: vi.fn().mockResolvedValue({
        dissolvedOxygen: 5.2,
        ph: 7.7,
        temperature: 28.5,
        salinity: 15,
        turbidity: 20,
        recordedAt: new Date(Date.now() - 60_000),
      }),
    };
    mockPondsService = {
      findPondById: vi.fn().mockResolvedValue({
        pondId,
        devices: [{ deviceId: 'dev-1' }],
      }),
    };

    service = new PredictionsService(
      mockPredictionRepo,
      mockPondRepo,
      mockConfigService,
      mockTelemetryService,
      mockPondsService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lấy danh sách các ao nuôi active chính xác', async () => {
    const ids = await service.getActivePondIds();
    expect(mockPondRepo.find).toHaveBeenCalledWith({
      where: { status: PondStatus.ACTIVE },
      select: ['pondId'],
    });
    expect(ids).toEqual([pondId, 'cbd3a63d-4308-4de1-b7e1-d9c8e3d3bbf5']);
  });

  it('sử dụng kết quả AI và đánh dấu isFallback: false khi API AI thành công', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        predictedDO: 4.8,
        predictedPH: 7.6,
        riskScore: 25,
        riskLevel: 'SAFE',
      }),
    } as any);

    const result = await service.predictForPond(pondId);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai-service:8000/predict',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    const requestBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      pondId,
      dissolvedOxygen: 5.2,
      ph: 7.7,
      temperature: 28.5,
      salinity: 15,
      turbidity: 20,
    });
    expect(requestBody).not.toHaveProperty('currentDO');
    expect(requestBody).not.toHaveProperty('currentPH');
    expect(requestBody).not.toHaveProperty('currentTemp');
    expect(requestBody.timestamp).toMatch(/Z$/u);
    expect(result.isFallback).toBe(false);
    expect(result.predictionSource).toBe('AI_MICROSERVICE');
    expect(result.predictedDO).toBe(4.8);
    expect(result.riskScore).toBe(0.25);
    expect(result.riskLevel).toBe(RiskLevel.LOW);
  });

  it('fallback khi response AI vi phạm contract thay vì lưu score hoặc enum không hợp lệ', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        predictedDO: 4.8,
        predictedPH: 7.6,
        riskScore: 0.25,
        riskLevel: 'LOW',
      }),
    } as any);

    const result = await service.predictForPond(pondId);

    expect(result.isFallback).toBe(true);
    expect(result.predictionSource).toBe('HEURISTIC_RULE');
  });

  it('tự động fallback về HEURISTIC_RULE và đánh dấu isFallback: true khi gọi AI thất bại hoặc timeout', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connect timeout'));

    const result = await service.predictForPond(pondId);

    expect(result.isFallback).toBe(true);
    expect(result.predictionSource).toBe('HEURISTIC_RULE');
    expect(result.predictedDO).toBeDefined();
    expect(result.riskLevel).toBeDefined();
  });

  it('fallback khi FastAPI trả 503 RISK_RULES_PENDING_APPROVAL, không lưu AI_MICROSERVICE', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        detail: { code: 'RISK_RULES_PENDING_APPROVAL' },
      }),
    } as any);

    const result = await service.predictForPond(pondId);

    expect(result.isFallback).toBe(true);
    expect(result.predictionSource).toBe('HEURISTIC_RULE');
    expect(result.riskLevel).toBe(RiskLevel.LOW);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(1);
  });

  it.each([
    ['missing salinity', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, turbidity: 20, recordedAt: new Date(Date.now() - 60_000) }],
    ['missing turbidity', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, recordedAt: new Date(Date.now() - 60_000) }],
    ['invalid salinity', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: Number.NaN, turbidity: 20, recordedAt: new Date(Date.now() - 60_000) }],
    ['out-of-range temperature', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 60, salinity: 15, turbidity: 20, recordedAt: new Date(Date.now() - 60_000) }],
  ])('rejects %s without HTTP request or persistence', async (_scenario, telemetry) => {
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce(telemetry);
    global.fetch = vi.fn();

    await expect(service.predictForPond(pondId)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPredictionRepo.create).not.toHaveBeenCalled();
    expect(mockPredictionRepo.save).not.toHaveBeenCalled();
  });

  it.each([
    ['missing telemetry', undefined, 'PREDICTION_TELEMETRY_MISSING'],
    ['missing recordedAt', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20 }, 'PREDICTION_TELEMETRY_INVALID'],
    ['malformed recordedAt', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20, recordedAt: 'not-a-date' }, 'PREDICTION_TELEMETRY_INVALID'],
    ['future telemetry', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20, recordedAt: new Date(Date.now() + 60_000) }, 'PREDICTION_TELEMETRY_FUTURE'],
    ['stale telemetry', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20, recordedAt: new Date(Date.now() - 16 * 60_000) }, 'PREDICTION_TELEMETRY_STALE'],
  ])('returns a structured no-persistence error for %s', async (_scenario, telemetry, errorCode) => {
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce(telemetry);
    global.fetch = vi.fn();

    try {
      await service.predictForPond(pondId);
      throw new Error('expected prediction to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ errorCode });
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPredictionRepo.create).not.toHaveBeenCalled();
    expect(mockPredictionRepo.save).not.toHaveBeenCalled();
  });

  it('uses HEURISTIC_RULE only with valid telemetry when production AI approval is pending', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'AI_PREDICTION_API_URL') return 'http://ai-service:8000/predict';
      if (key === 'AI_PREDICTION_CONTRACT_VERSION') return 'ai-develop-v1';
      if (key === 'AI_PRODUCTION_INFERENCE_APPROVED') return 'false';
      if (key === 'PREDICTION_TELEMETRY_MAX_AGE_MINUTES') return '15';
      return null;
    });
    global.fetch = vi.fn();

    const result = await service.predictForPond(pondId);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.isFallback).toBe(true);
    expect(result.predictionSource).toBe('HEURISTIC_RULE');
  });

  it('rejects an unknown pond before it can call FastAPI', async () => {
    mockPondRepo.findOne.mockResolvedValueOnce(null);
    global.fetch = vi.fn();

    await expect(service.predictForPond(pondId)).rejects.toThrow('Không tìm thấy ao nuôi');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips maintenance-device calibration telemetry when building an AI input', async () => {
    mockPondRepo.findOne.mockResolvedValueOnce({
      pondId,
      devices: [
        { deviceId: 'maintenance-device', status: DeviceStatus.MAINTENANCE },
        { deviceId: 'water-device', status: DeviceStatus.ONLINE },
      ],
    });
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({
      recordedAt: new Date(),
      dissolvedOxygen: 5.2,
      ph: 7.7,
      temperature: 28.5,
      salinity: 15,
      turbidity: 20,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        predictedDO: 4.8,
        predictedPH: 7.6,
        riskScore: 25,
        riskLevel: 'SAFE',
      }),
    } as any);

    await service.predictForPond(pondId);

    expect(mockTelemetryService.getLatestByDeviceId).toHaveBeenCalledTimes(1);
    expect(mockTelemetryService.getLatestByDeviceId).toHaveBeenCalledWith('water-device');
  });

  it('does not query prediction history when pond access is rejected', async () => {
    mockPondsService.findPondById.mockRejectedValueOnce(
      new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!'),
    );

    await expect(
      service.getPredictionHistory(pondId, 20, 'manager-outside-scope', Role.MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPredictionRepo.find).not.toHaveBeenCalled();
  });

  it('uses existing pond scope checks before an authenticated trigger can call FastAPI', async () => {
    mockPondsService.findPondById.mockRejectedValueOnce(
      new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!'),
    );
    global.fetch = vi.fn();

    await expect(
      service.predictForPond(pondId, 'manager-outside-scope', Role.MANAGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPredictionRepo.save).not.toHaveBeenCalled();
  });

  describe('P2-1 getWaterQualityForecast & getDiseaseRiskAssessment', () => {
    let mockManualLogRepo: any;
    let mockShrimpBatchRepo: any;
    let extendedService: PredictionsService;

    beforeEach(() => {
      mockManualLogRepo = {
        findOne: vi.fn().mockResolvedValue(null),
      };
      mockShrimpBatchRepo = {
        findOne: vi.fn().mockResolvedValue(null),
      };
      extendedService = new PredictionsService(
        mockPredictionRepo,
        mockPondRepo,
        mockConfigService,
        mockTelemetryService,
        mockPondsService,
        new AiPredictionHttpClient(mockConfigService),
        mockManualLogRepo,
        mockShrimpBatchRepo,
      );
    });

    it('rejects getWaterQualityForecast via RBAC before querying telemetry, cache, or HTTP', async () => {
      mockPondsService.findPondById.mockRejectedValueOnce(
        new ForbiddenException('Bạn không được phân công cho ao nuôi này!'),
      );
      global.fetch = vi.fn();

      await expect(
        extendedService.getWaterQualityForecast(
          pondId,
          { horizonHours: 24, stepHours: 6, refresh: false },
          'farmer-outside',
          Role.FARMER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockPredictionRepo.findOne).not.toHaveBeenCalled();
      expect(mockTelemetryService.getLatestByDeviceId).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockPredictionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects getDiseaseRiskAssessment for unknown pond before telemetry/HTTP/DB writes', async () => {
      mockPondsService.findPondById.mockRejectedValueOnce(
        new NotFoundException(`Không tìm thấy ao nuôi với ID: ${pondId}`),
      );
      global.fetch = vi.fn();

      await expect(
        extendedService.getDiseaseRiskAssessment(
          pondId,
          { refresh: true },
          'admin-1',
          Role.ADMIN,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockTelemetryService.getLatestByDeviceId).not.toHaveBeenCalled();
      expect(mockManualLogRepo.findOne).not.toHaveBeenCalled();
      expect(mockShrimpBatchRepo.findOne).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockPredictionRepo.save).not.toHaveBeenCalled();
    });

    it('calls AI /water-quality, persists 1 packed record, and returns mapped WaterQualityForecastResponseDto', async () => {
      mockPredictionRepo.findOne.mockResolvedValueOnce(null);
      mockPondsService.findPondById.mockResolvedValueOnce({
        pondId,
        areaM2: 1200,
        depthM: 1.5,
        shrimpDensity: 100,
        devices: [{ deviceId: 'dev-1' }, { deviceId: 'dev-2' }],
      });
      mockTelemetryService.getLatestByDeviceId
        .mockResolvedValueOnce({
          dissolvedOxygen: 5.0,
          ph: 7.6,
          temperature: 28.0,
          salinity: 14,
          turbidity: 18,
          recordedAt: new Date('2026-11-22T01:00:00.000Z'),
        })
        .mockResolvedValueOnce({
          dissolvedOxygen: 5.4,
          ph: 7.8,
          temperature: 28.7,
          salinity: 15,
          turbidity: 22,
          recordedAt: new Date('2026-11-22T01:55:00.000Z'),
        });
      mockTelemetryService.getHistoryByDeviceId = vi.fn().mockResolvedValue({
        data: [
          {
            dissolvedOxygen: 5.1,
            ph: 7.7,
            temperature: 28.2,
            recordedAt: new Date('2026-11-22T00:00:00.000Z'),
          },
        ],
        total: 1,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          overallRiskScore: 45,
          overallRiskLevel: 'WARNING',
          series: [
            {
              offsetHours: 6,
              predictedTime: '2026-11-22T08:00:00.000Z',
              predictedDO: 4.9,
              predictedPH: 7.7,
              predictedTemperature: 28.9,
              riskScore: 20,
              riskLevel: 'SAFE',
            },
            {
              offsetHours: 12,
              predictedTime: '2026-11-22T14:00:00.000Z',
              predictedDO: 3.8,
              predictedPH: 7.5,
              predictedTemperature: 29.8,
              riskScore: 45,
              riskLevel: 'WARNING',
            },
          ],
          factors: ['Pre-dawn respiration drop'],
          recommendations: ['Run paddlewheel aerators overnight'],
        }),
      } as unknown as Response);

      const result = await extendedService.getWaterQualityForecast(
        pondId,
        { horizonHours: 12, stepHours: 6, refresh: false },
        'manager-1',
        Role.MANAGER,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'http://ai-service:8000/predict/water-quality',
        expect.objectContaining({ method: 'POST' }),
      );
      const sentBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(sentBody.currentMetrics).toEqual({
        currentDO: 5.4,
        currentPH: 7.8,
        currentTemp: 28.7,
        salinity: 15,
        turbidity: 22,
      });
      expect(sentBody.recentHistory).toHaveLength(2);
      expect(sentBody.recentHistory[0]).toMatchObject({
        recordedAt: '2026-11-22T00:00:00.000Z',
        dissolvedOxygen: 5.1,
      });

      expect(mockPredictionRepo.save).toHaveBeenCalledTimes(1);
      const savedArg = mockPredictionRepo.save.mock.calls[0][0];
      expect(savedArg).toMatchObject({
        pondId,
        predictionType: PredictionType.WATER_QUALITY,
        horizonHours: 12,
        predictedDO: 3.8,
        predictedPH: 7.5,
        predictedTemperature: 29.8,
        riskScore: 0.45,
        riskLevel: RiskLevel.MEDIUM,
        isFallback: false,
        predictionSource: 'AI_MICROSERVICE',
      });

      expect(result).toMatchObject({
        predictionId: 'pred-1',
        pondId,
        predictionType: PredictionType.WATER_QUALITY,
        horizonHours: 12,
        stepHours: 6,
        cached: false,
        isFallback: false,
        predictionSource: 'AI_MICROSERVICE',
        riskScore: 0.45,
        riskLevel: RiskLevel.MEDIUM,
        summary: {
          minDO: 3.8,
          maxDO: 4.9,
          peakRiskOffsetHours: 12,
        },
        factors: ['Pre-dawn respiration drop'],
        recommendations: ['Run paddlewheel aerators overnight'],
      });
      expect(result).not.toHaveProperty('message');
    });

    it('uses deterministic 12h-24h heuristic fallback when AI fails or telemetry is incomplete', async () => {
      mockPredictionRepo.findOne.mockResolvedValueOnce(null);
      mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce(null);
      global.fetch = vi.fn();

      const result = await extendedService.getWaterQualityForecast(
        pondId,
        { horizonHours: 24, stepHours: 6, refresh: false },
        'admin-1',
        Role.ADMIN,
      );

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.isFallback).toBe(true);
      expect(result.predictionSource).toBe('HEURISTIC_RULE');
      expect(result.cached).toBe(false);
      expect(result.series).toHaveLength(4);
      expect(result.series.map((p) => p.offsetHours)).toEqual([6, 12, 18, 24]);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(1);
      expect(mockPredictionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('returns cached water quality forecast within 15m TTL when refresh=false and bypasses when refresh=true', async () => {
      const cachedRow = {
        predictionId: 'cached-wq-1',
        pondId,
        predictionType: PredictionType.WATER_QUALITY,
        horizonHours: 24,
        isFallback: false,
        predictionSource: 'AI_MICROSERVICE',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        payload: {
          generatedAt: '2026-11-22T01:55:00.000Z',
          predictedTime: '2026-11-23T01:55:00.000Z',
          horizonHours: 24,
          stepHours: 6,
          riskScore: 0.2,
          riskLevel: RiskLevel.LOW,
          currentMetrics: {
            currentDO: 5.5,
            currentPH: 7.8,
            currentTemp: 28.0,
            salinity: 15,
            turbidity: 20,
            recordedAt: '2026-11-22T01:54:00.000Z',
          },
          summary: {
            minDO: 4.8,
            maxDO: 5.8,
            avgDO: 5.3,
            minPH: 7.7,
            maxPH: 7.9,
            minTemperature: 27.5,
            maxTemperature: 28.9,
            peakRiskScore: 0.2,
            peakRiskOffsetHours: 18,
            peakRiskTime: '2026-11-22T19:55:00.000Z',
          },
          series: [
            {
              offsetHours: 6,
              predictedTime: '2026-11-22T07:55:00.000Z',
              predictedDO: 5.2,
              predictedPH: 7.8,
              predictedTemperature: 28.5,
              riskScore: 0.2,
              riskLevel: RiskLevel.LOW,
            },
          ],
          factors: ['Cached factor'],
          recommendations: ['Cached rec'],
        },
      };
      mockPredictionRepo.findOne.mockResolvedValueOnce(cachedRow);
      global.fetch = vi.fn();

      const cachedResult = await extendedService.getWaterQualityForecast(
        pondId,
        { horizonHours: 24, stepHours: 6, refresh: false },
        'manager-1',
        Role.MANAGER,
      );

      expect(cachedResult.cached).toBe(true);
      expect(cachedResult.predictionId).toBe('cached-wq-1');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockPredictionRepo.save).not.toHaveBeenCalled();

      // Now verify refresh=true bypasses cache and persists a fresh record
      global.fetch = vi.fn().mockRejectedValue(new Error('AI offline'));
      const refreshedResult = await extendedService.getWaterQualityForecast(
        pondId,
        { horizonHours: 24, stepHours: 6, refresh: true },
        'manager-1',
        Role.MANAGER,
      );

      expect(mockPredictionRepo.findOne).toHaveBeenCalledTimes(1);
      expect(refreshedResult.cached).toBe(false);
      expect(refreshedResult.isFallback).toBe(true);
      expect(mockPredictionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('calls AI /disease-risk with 24h swings, ManualTestLog NH3/NO2, and active ShrimpBatch DoC', async () => {
      mockPredictionRepo.findOne.mockResolvedValueOnce(null);
      mockPondsService.findPondById.mockResolvedValueOnce({
        pondId,
        areaM2: 1500,
        depthM: 1.5,
        shrimpDensity: 120,
        devices: [{ deviceId: 'dev-1' }],
        manualLogs: [
          { nh3Value: 0.02, no2Value: 0.1, testedAt: new Date('2026-11-20T00:00:00.000Z') },
          { nh3Value: 0.08, no2Value: 0.6, testedAt: new Date('2026-11-22T01:00:00.000Z') },
        ],
      });
      mockTelemetryService.getHistoryByDeviceId = vi.fn().mockResolvedValue({
        data: [
          {
            dissolvedOxygen: 4.1,
            ph: 7.4,
            temperature: 25.0,
            recordedAt: new Date('2026-11-21T20:00:00.000Z'),
          },
          {
            dissolvedOxygen: 5.5,
            ph: 8.1,
            temperature: 28.5,
            recordedAt: new Date('2026-11-22T01:30:00.000Z'),
          },
        ],
        total: 2,
      });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      mockShrimpBatchRepo.findOne.mockResolvedValueOnce({
        batchId: 'batch-1',
        pondId,
        stockingDate: thirtyDaysAgo,
        shrimpSpecies: 'Litopenaeus vannamei',
        status: ShrimpBatchStatus.ACTIVE,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          overallRiskScore: 68,
          overallRiskLevel: 'WARNING',
          diseases: [
            {
              code: 'WSSV',
              name: 'Bệnh Đốm trắng (WSSV)',
              riskScore: 68,
              riskLevel: 'WARNING',
              indicators: ['24h temp swing 3.5C'],
              recommendations: ['Check pond temperature stability'],
            },
            {
              code: 'AHPND_EMS',
              name: 'Bệnh Hoại tử gan tụy cấp (AHPND/EMS)',
              riskScore: 55,
              riskLevel: 'WARNING',
              indicators: ['NH3 elevated at 0.08 mg/L'],
              recommendations: ['Apply Bacillus probiotics'],
            },
          ],
          recommendations: ['Check pond temperature stability', 'Apply Bacillus probiotics'],
        }),
      } as unknown as Response);

      const result = await extendedService.getDiseaseRiskAssessment(
        pondId,
        { refresh: false },
        'manager-1',
        Role.MANAGER,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'http://ai-service:8000/predict/disease-risk',
        expect.objectContaining({ method: 'POST' }),
      );
      const sentBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(sentBody.currentMetrics).toMatchObject({
        currentDO: 5.2,
        currentPH: 7.7,
        currentTemp: 28.5,
        nh3: 0.08,
        no2: 0.6,
      });
      expect(sentBody.variability24h).toEqual({
        temperatureDelta: 3.5,
        phDelta: 0.7,
        minDO: 4.1,
        minTemp: 25,
        maxTemp: 28.5,
      });
      expect(sentBody.pondProfile.daysOfCulture).toBeGreaterThanOrEqual(29);

      expect(mockPredictionRepo.save).toHaveBeenCalledTimes(1);
      expect(mockPredictionRepo.save.mock.calls[0][0]).toMatchObject({
        pondId,
        predictionType: PredictionType.DISEASE_RISK,
        horizonHours: 24,
        riskScore: 0.68,
        riskLevel: RiskLevel.MEDIUM,
        isFallback: false,
        predictionSource: 'AI_MICROSERVICE',
      });
      expect(result.diseases).toHaveLength(2);
      expect(result.cached).toBe(false);
    });

    it('computes epidemiological fallback for WSSV and AHPND_EMS even with missing telemetry', async () => {
      mockPredictionRepo.findOne.mockResolvedValueOnce(null);
      mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce(null);
      mockManualLogRepo.findOne.mockResolvedValueOnce({ nh3Value: 0.12, no2Value: 1.2 });
      global.fetch = vi.fn();

      const result = await extendedService.getDiseaseRiskAssessment(
        pondId,
        { refresh: false },
        'admin-1',
        Role.ADMIN,
      );

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.isFallback).toBe(true);
      expect(result.predictionSource).toBe('HEURISTIC_RULE');
      expect(result.diseases.map((d) => d.diseaseCode)).toEqual(['WSSV', 'AHPND_EMS']);
      const ahpnd = result.diseases.find((d) => d.diseaseCode === 'AHPND_EMS');
      expect(ahpnd!.riskScore).toBeGreaterThanOrEqual(0.5);
      // Relational NOT NULL columns still receive safe baseline numbers when telemetry is null
      expect(mockPredictionRepo.save.mock.calls[0][0].predictedDO).toBe(5.5);
      expect(mockPredictionRepo.save.mock.calls[0][0].predictedPH).toBe(7.8);
      expect(result.inputSnapshot.currentDO).toBeNull();
      expect(result.inputSnapshot.nh3).toBe(0.12);
    });

    it('returns cached disease risk assessment within TTL when refresh=false and bypasses when refresh=true', async () => {
      mockPredictionRepo.findOne.mockResolvedValueOnce({
        predictionId: 'cached-dr-1',
        pondId,
        predictionType: PredictionType.DISEASE_RISK,
        isFallback: true,
        predictionSource: 'HEURISTIC_RULE',
        createdAt: new Date(Date.now() - 2 * 60 * 1000),
        payload: {
          assessedAt: '2026-11-22T01:58:00.000Z',
          validUntil: '2026-11-23T01:58:00.000Z',
          overallRiskScore: 0.2,
          overallRiskLevel: RiskLevel.LOW,
          diseases: [
            {
              diseaseCode: 'WSSV',
              diseaseName: 'Bệnh đốm trắng (WSSV)',
              riskScore: 0.2,
              riskLevel: RiskLevel.LOW,
              indicators: ['OK'],
              recommendations: ['Monitor'],
            },
            {
              diseaseCode: 'AHPND_EMS',
              diseaseName: 'Bệnh hoại tử gan tụy cấp (AHPND/EMS)',
              riskScore: 0.15,
              riskLevel: RiskLevel.LOW,
              indicators: ['OK'],
              recommendations: ['Maintain'],
            },
          ],
          inputSnapshot: {
            currentDO: 5.2,
            currentPH: 7.7,
            currentTemp: 28.5,
            salinity: 15,
            turbidity: 20,
            nh3: null,
            no2: null,
            temperatureDelta24h: null,
            phDelta24h: null,
            minDO24h: null,
            minTemp24h: null,
            maxTemp24h: null,
            daysOfCulture: null,
            shrimpSpecies: null,
            shrimpDensity: null,
          },
          recommendations: ['Monitor', 'Maintain'],
        },
      });
      global.fetch = vi.fn();

      const cached = await extendedService.getDiseaseRiskAssessment(
        pondId,
        { refresh: false },
        'farmer-1',
        Role.FARMER,
      );
      expect(cached.cached).toBe(true);
      expect(cached.predictionId).toBe('cached-dr-1');
      expect(mockPredictionRepo.save).not.toHaveBeenCalled();

      global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));
      const refreshed = await extendedService.getDiseaseRiskAssessment(
        pondId,
        { refresh: true },
        'farmer-1',
        Role.FARMER,
      );
      expect(refreshed.cached).toBe(false);
      expect(mockPredictionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('filters getLatestPrediction by WATER_QUALITY and supports optional predictionType on getPredictionHistory', async () => {
      mockPredictionRepo.findOne.mockResolvedValueOnce(null);
      mockPredictionRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await extendedService.getLatestPrediction(pondId, 'admin-1', Role.ADMIN);
      expect(mockPredictionRepo.findOne).toHaveBeenCalledWith({
        where: { pondId, predictionType: PredictionType.WATER_QUALITY },
        order: { predictedTime: 'DESC' },
      });

      await extendedService.getPredictionHistory(pondId, 10, 'admin-1', Role.ADMIN);
      expect(mockPredictionRepo.find).toHaveBeenNthCalledWith(1, {
        where: { pondId },
        order: { predictedTime: 'DESC' },
        take: 10,
      });

      await extendedService.getPredictionHistory(
        pondId,
        15,
        'admin-1',
        Role.ADMIN,
        PredictionType.DISEASE_RISK,
      );
      expect(mockPredictionRepo.find).toHaveBeenNthCalledWith(2, {
        where: { pondId, predictionType: PredictionType.DISEASE_RISK },
        order: { predictedTime: 'DESC' },
        take: 15,
      });
    });
  });
});
