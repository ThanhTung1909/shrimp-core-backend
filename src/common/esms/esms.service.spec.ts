import { InternalServerErrorException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EsmsService } from './esms.service.js';

describe('EsmsService alert transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config = {
    get: vi.fn((key: string) => {
      const values: Record<string, string> = {
        ESMS_API_KEY: 'test-key',
        ESMS_SECRET_KEY: 'test-secret',
        ESMS_BRANDNAME: 'TestBrand',
        ESMS_TIMEOUT_MS: '25',
      };
      return values[key];
    }),
  };

  it('applies an abort signal to alert provider requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(JSON.stringify({ CodeResult: '100', SMSID: 'test-1' })),
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new EsmsService(config as any);

    await service.sendAlertSMS('0901234567', 'Critical oxygen alert');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('turns an aborted provider request into a controlled gateway error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      ),
    );
    const service = new EsmsService(config as any);

    await expect(service.sendAlertSMS('0901234567', 'Critical oxygen alert')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('uses the safe mock transport for alert SMS in test mode', async () => {
    const mockConfig = {
      get: vi.fn((key: string) => ({ SMS_MODE: 'mock', NODE_ENV: 'test' })[key]),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new EsmsService(mockConfig as any);

    const result = await service.sendAlertSMS('0901234567', 'Critical oxygen alert');

    expect(result).toMatchObject({ CodeResult: '100', IsMock: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
