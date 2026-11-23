import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiPredictionHttpClient } from './ai-prediction-http.client.js';

function createClient(values: Record<string, string | number | undefined>): AiPredictionHttpClient {
  const configService = {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new AiPredictionHttpClient(configService);
}

describe('AiPredictionHttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL normalization and endpoint derivation', () => {
    it.each([
      [
        'trailing slash on /api/predict/',
        'http://localhost:8000/api/predict/',
        'http://localhost:8000/api/predict',
        'http://localhost:8000/api/predict/water-quality',
        'http://localhost:8000/api/predict/disease-risk',
      ],
      [
        'multiple trailing slashes on /predict///',
        'http://ai-service:8000/predict///',
        'http://ai-service:8000/predict',
        'http://ai-service:8000/predict/water-quality',
        'http://ai-service:8000/predict/disease-risk',
      ],
      [
        'root origin without path',
        'http://localhost:8000',
        'http://localhost:8000/api/predict',
        'http://localhost:8000/api/predict/water-quality',
        'http://localhost:8000/api/predict/disease-risk',
      ],
      [
        'root origin with trailing slash',
        'http://localhost:8000/',
        'http://localhost:8000/api/predict',
        'http://localhost:8000/api/predict/water-quality',
        'http://localhost:8000/api/predict/disease-risk',
      ],
      [
        '/api base path',
        'http://localhost:8000/api/',
        'http://localhost:8000/api/predict',
        'http://localhost:8000/api/predict/water-quality',
        'http://localhost:8000/api/predict/disease-risk',
      ],
      [
        '/api/v1 base path',
        'http://localhost:8000/api/v1/',
        'http://localhost:8000/api/v1/predict',
        'http://localhost:8000/api/v1/predict/water-quality',
        'http://localhost:8000/api/v1/predict/disease-risk',
      ],
      [
        'custom path',
        'http://localhost:8000/ml/v2/',
        'http://localhost:8000/ml/v2',
        'http://localhost:8000/ml/v2/water-quality',
        'http://localhost:8000/ml/v2/disease-risk',
      ],
      [
        'preserves query string cleanly without double slashes',
        'http://localhost:8000/api/predict/?env=prod',
        'http://localhost:8000/api/predict?env=prod',
        'http://localhost:8000/api/predict/water-quality?env=prod',
        'http://localhost:8000/api/predict/disease-risk?env=prod',
      ],
    ])(
      'derives endpoints for %s',
      (_scenario, baseUrl, expectedLegacy, expectedWaterQuality, expectedDiseaseRisk) => {
        const client = createClient({ AI_PREDICTION_API_URL: baseUrl });
        expect(client.resolveEndpointUrl('legacy')).toBe(expectedLegacy);
        expect(client.resolveEndpointUrl('water-quality')).toBe(expectedWaterQuality);
        expect(client.resolveEndpointUrl('disease-risk')).toBe(expectedDiseaseRisk);
      },
    );

    it('uses AI_WATER_QUALITY_API_URL and AI_DISEASE_RISK_API_URL overrides with trailing slashes stripped', () => {
      const client = createClient({
        AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict',
        AI_WATER_QUALITY_API_URL: 'https://wq.example.com/v2/forecast///?mode=full',
        AI_DISEASE_RISK_API_URL: 'https://disease.example.com/risk/',
      });

      expect(client.resolveEndpointUrl('legacy')).toBe('http://localhost:8000/api/predict');
      expect(client.resolveEndpointUrl('water-quality')).toBe(
        'https://wq.example.com/v2/forecast?mode=full',
      );
      expect(client.resolveEndpointUrl('disease-risk')).toBe('https://disease.example.com/risk');
    });

    it('returns null when neither base URL nor override is configured', () => {
      const client = createClient({});
      expect(client.resolveEndpointUrl('legacy')).toBeNull();
      expect(client.resolveEndpointUrl('water-quality')).toBeNull();
      expect(client.resolveEndpointUrl('disease-risk')).toBeNull();
    });
  });

  describe('HTTP requests and error handling', () => {
    it('returns NOT_CONFIGURED without calling fetch when URL is unset', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      const result = await createClient({}).predictWaterQuality({ pondId: 'p1' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        category: 'NOT_CONFIGURED',
        latencyMs: 0,
      });
    });

    it('omits X-API-Key header when AI_PREDICTION_API_KEY is not configured', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ ok: true }),
      } as unknown as Response);

      const client = createClient({ AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict' });
      const result = await client.predictLegacy({ pondId: 'p1' });

      expect(result).toMatchObject({ ok: true, status: 200, data: { ok: true } });
      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init.headers).not.toHaveProperty('X-API-Key');
    });

    it('includes X-API-Key header when AI_PREDICTION_API_KEY is configured', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ series: [] }),
      } as unknown as Response);

      const client = createClient({
        AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict/',
        AI_PREDICTION_API_KEY: 'secret-key-123',
      });
      await client.predictDiseaseRisk({ pondId: 'p1' });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/predict/disease-risk',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'secret-key-123',
          },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns HTTP_ERROR on non-2xx responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      } as unknown as Response);

      const client = createClient({ AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict' });
      const result = await client.predictWaterQuality({ pondId: 'p1' });

      expect(result).toMatchObject({
        ok: false,
        category: 'HTTP_ERROR',
        status: 503,
      });
    });

    it('returns INVALID_JSON when response JSON parsing fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      } as unknown as Response);

      const client = createClient({ AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict' });
      const result = await client.predictWaterQuality({ pondId: 'p1' });

      expect(result).toMatchObject({
        ok: false,
        category: 'INVALID_JSON',
        status: 200,
      });
    });

    it('returns TIMEOUT when request exceeds AI_PREDICTION_TIMEOUT_MS', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      global.fetch = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      );

      const client = createClient({
        AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict',
        AI_PREDICTION_TIMEOUT_MS: 20,
      });
      const result = await client.predictDiseaseRisk({ pondId: 'p1' });

      expect(result).toMatchObject({
        ok: false,
        category: 'TIMEOUT',
      });
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('returns TRANSPORT on network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const client = createClient({ AI_PREDICTION_API_URL: 'http://localhost:8000/api/predict' });
      const result = await client.predictLegacy({ pondId: 'p1' });

      expect(result).toMatchObject({
        ok: false,
        category: 'TRANSPORT',
        message: 'ECONNREFUSED',
      });
    });
  });
});
