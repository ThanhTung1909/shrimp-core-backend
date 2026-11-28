import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AiEndpointKind = 'legacy' | 'water-quality' | 'disease-risk';

export type AiPredictionHttpErrorCategory =
  | 'NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'TRANSPORT'
  | 'HTTP_ERROR'
  | 'INVALID_JSON';

export type AiPredictionHttpResult =
  | { ok: true; data: unknown; status: number; latencyMs: number }
  | {
      ok: false;
      category: AiPredictionHttpErrorCategory;
      status?: number;
      message: string;
      latencyMs: number;
    };

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class AiPredictionHttpClient {
  constructor(
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  async predictLegacy(payload: unknown, correlationId?: string): Promise<AiPredictionHttpResult> {
    return this.post('legacy', payload, correlationId);
  }

  async predictWaterQuality(payload: unknown): Promise<AiPredictionHttpResult> {
    return this.post('water-quality', payload);
  }

  async predictDiseaseRisk(payload: unknown): Promise<AiPredictionHttpResult> {
    return this.post('disease-risk', payload);
  }

  resolveEndpointUrl(kind: AiEndpointKind): string | null {
    if (kind === 'water-quality') {
      const override = this.getTrimmedConfig('AI_WATER_QUALITY_API_URL');
      if (override) {
        return normalizeOverrideUrl(override);
      }
    } else if (kind === 'disease-risk') {
      const override = this.getTrimmedConfig('AI_DISEASE_RISK_API_URL');
      if (override) {
        return normalizeOverrideUrl(override);
      }
    }

    const baseUrl = this.getTrimmedConfig('AI_PREDICTION_API_URL');
    if (!baseUrl) {
      return null;
    }

    return deriveEndpointUrl(baseUrl, kind);
  }

  private async post(kind: AiEndpointKind, payload: unknown, correlationId?: string): Promise<AiPredictionHttpResult> {
    const url = this.resolveEndpointUrl(kind);
    if (!url) {
      return {
        ok: false,
        category: 'NOT_CONFIGURED',
        message: 'AI prediction endpoint URL is not configured',
        latencyMs: 0,
      };
    }

    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (correlationId) {
      headers['X-Request-ID'] = correlationId;
    }
    const apiKey = this.getTrimmedConfig('AI_PREDICTION_API_KEY');
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const latencyMs = Math.max(0, Date.now() - startedAt);

      if (!response.ok) {
        return {
          ok: false,
          category: 'HTTP_ERROR',
          status: response.status,
          message: `AI microservice returned HTTP ${response.status}`,
          latencyMs,
        };
      }

      try {
        const data: unknown = await response.json();
        return {
          ok: true,
          data,
          status: response.status,
          latencyMs,
        };
      } catch (jsonErr) {
        return {
          ok: false,
          category: 'INVALID_JSON',
          status: response.status,
          message:
            jsonErr instanceof Error
              ? `Invalid JSON response from AI microservice: ${jsonErr.message}`
              : 'Invalid JSON response from AI microservice',
          latencyMs,
        };
      }
    } catch (err) {
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const isAbort =
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name?: unknown }).name === 'AbortError';

      if (isAbort) {
        return {
          ok: false,
          category: 'TIMEOUT',
          message: `AI microservice request timed out after ${timeoutMs}ms`,
          latencyMs,
        };
      }

      return {
        ok: false,
        category: 'TRANSPORT',
        message: err instanceof Error ? err.message : String(err),
        latencyMs,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getTrimmedConfig(key: string): string | null {
    const raw = this.configService?.get<string>(key);
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private getTimeoutMs(): number {
    const raw = this.configService?.get<string | number>('AI_PREDICTION_TIMEOUT_MS');
    const parsed = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }
}

function normalizeOverrideUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const cleanedPath = url.pathname.replace(/\/+$/u, '').replace(/\/{2,}/gu, '/');
    return `${url.origin}${cleanedPath}${url.search}${url.hash}`;
  } catch {
    return raw.replace(/\/+$/u, '');
  }
}

function deriveEndpointUrl(baseUrl: string, kind: AiEndpointKind): string {
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/+$/u, '').replace(/\/{2,}/gu, '/');
    const targetPath = appendEndpointPath(basePath, kind);
    return `${url.origin}${targetPath}${url.search}${url.hash}`;
  } catch {
    const stripped = baseUrl.replace(/\/+$/u, '');
    return appendEndpointPath(stripped, kind);
  }
}

function appendEndpointPath(basePath: string, kind: AiEndpointKind): string {
  const isPredict = /(?:^|\/)predict$/u.test(basePath);
  const isApiBase = /(?:^|\/)api(?:\/v1)?$/u.test(basePath);
  const isRoot = basePath === '' || basePath === '/';

  if (kind === 'legacy') {
    if (isPredict) return basePath;
    if (isApiBase) return `${basePath}/predict`;
    if (isRoot) return '/api/predict';
    return basePath;
  }

  if (isPredict) return `${basePath}/${kind}`;
  if (isApiBase) return `${basePath}/predict/${kind}`;
  if (isRoot) return `/api/predict/${kind}`;
  return `${basePath}/${kind}`;
}
