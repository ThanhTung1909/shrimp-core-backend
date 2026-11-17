import { ForbiddenException } from '@nestjs/common';
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
        recordedAt: new Date(),
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
      currentDO: 5.2,
      currentPH: 7.7,
      currentTemp: 28.5,
      salinity: 15,
      turbidity: 20,
    });
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
    ['missing DO', { ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20 }],
    ['missing pH', { dissolvedOxygen: 5.2, temperature: 28.5, salinity: 15, turbidity: 20 }],
    ['missing temperature', { dissolvedOxygen: 5.2, ph: 7.7, salinity: 15, turbidity: 20 }],
    ['missing salinity', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, turbidity: 20 }],
    ['missing turbidity', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15 }],
    ['invalid salinity', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: Number.NaN, turbidity: 20 }],
    ['infinite DO', { dissolvedOxygen: Infinity, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20 }],
    ['out-of-range temperature', { dissolvedOxygen: 5.2, ph: 7.7, temperature: 60, salinity: 15, turbidity: 20 }],
  ])('rejects invalid current telemetry for %s before HTTP or persistence', async (_scenario, telemetry) => {
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({ ...telemetry, recordedAt: new Date() });
    global.fetch = vi.fn();

    await expect(service.predictForPond(pondId)).rejects.toThrow('Telemetry của ao');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPredictionRepo.save).not.toHaveBeenCalled();
  });

  it('rejects stale telemetry instead of treating it as realtime or persisting a prediction', async () => {
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({
      dissolvedOxygen: 5.2,
      ph: 7.7,
      temperature: 28.5,
      salinity: 15,
      turbidity: 20,
      recordedAt: new Date(Date.now() - 16 * 60_000),
    });
    global.fetch = vi.fn();

    await expect(service.predictForPond(pondId)).rejects.toThrow('không còn mới');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPredictionRepo.save).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-timestamp'],
    ['future', new Date(Date.now() + 60_000)],
  ])('rejects %s telemetry timestamps before HTTP or persistence', async (_scenario, recordedAt) => {
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({
      dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20, recordedAt,
    });
    global.fetch = vi.fn();

    await expect(service.predictForPond(pondId)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPredictionRepo.save).not.toHaveBeenCalled();
  });

  it('honors a configured maximum telemetry age', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'AI_PREDICTION_API_URL') return 'http://ai-service:8000/predict';
      if (key === 'PREDICTION_TELEMETRY_MAX_AGE_MINUTES') return '20';
      return null;
    });
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({
      dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20,
      recordedAt: new Date(Date.now() - 16 * 60_000),
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as any);

    await expect(service.predictForPond(pondId)).resolves.toMatchObject({ isFallback: true });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('accepts telemetry exactly at the configured age boundary', async () => {
    const now = Date.parse('2026-11-17T08:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({
      dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20,
      recordedAt: new Date(now - 15 * 60_000),
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as any);

    await expect(service.predictForPond(pondId)).resolves.toMatchObject({ isFallback: true });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('sends the source telemetry timestamp and correlation ID to FastAPI', async () => {
    const recordedAt = new Date();
    mockTelemetryService.getLatestByDeviceId.mockResolvedValueOnce({
      dissolvedOxygen: 5.2, ph: 7.7, temperature: 28.5, salinity: 15, turbidity: 20, recordedAt,
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as any);

    await service.predictForPond(pondId, undefined, undefined, {
      triggerSource: 'scheduled', correlationId: 'queue:test-1', jobId: 'test-1',
    });

    const request = (global.fetch as any).mock.calls[0][1];
    expect(JSON.parse(request.body).timestamp).toBe(recordedAt.toISOString());
    expect(request.headers['X-Request-ID']).toBe('queue:test-1');
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
