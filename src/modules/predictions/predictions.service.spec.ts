import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PredictionsService } from './predictions.service.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';
import { Role } from '../../common/enums/role.enum.js';

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
});
