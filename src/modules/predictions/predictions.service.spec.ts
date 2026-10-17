import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PredictionsService } from './predictions.service.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';

describe('PredictionsService', () => {
  let service: PredictionsService;
  let mockPredictionRepo: any;
  let mockPondRepo: any;
  let mockConfigService: any;
  let mockTelemetryService: any;

  beforeEach(() => {
    mockPredictionRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ predictionId: 'pred-1', ...data })),
      findOne: vi.fn(),
      find: vi.fn(),
    };

    mockPondRepo = {
      find: vi.fn().mockResolvedValue([{ pondId: 'pond-1' }, { pondId: 'pond-2' }]),
      findOne: vi.fn().mockResolvedValue({
        pondId: 'pond-1',
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
      }),
    };

    service = new PredictionsService(
      mockPredictionRepo,
      mockPondRepo,
      mockConfigService,
      mockTelemetryService,
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
    expect(ids).toEqual(['pond-1', 'pond-2']);
  });

  it('sử dụng kết quả AI và đánh dấu isFallback: false khi API AI thành công', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        predictedDO: 4.8,
        predictedPH: 7.6,
        riskScore: 0.25,
        riskLevel: RiskLevel.LOW,
      }),
    } as any);

    const result = await service.predictForPond('pond-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai-service:8000/predict',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.isFallback).toBe(false);
    expect(result.predictionSource).toBe('AI_MICROSERVICE');
    expect(result.predictedDO).toBe(4.8);
  });

  it('tự động fallback về HEURISTIC_RULE và đánh dấu isFallback: true khi gọi AI thất bại hoặc timeout', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connect timeout'));

    const result = await service.predictForPond('pond-1');

    expect(result.isFallback).toBe(true);
    expect(result.predictionSource).toBe('HEURISTIC_RULE');
    expect(result.predictedDO).toBeDefined();
    expect(result.riskLevel).toBeDefined();
  });
});
