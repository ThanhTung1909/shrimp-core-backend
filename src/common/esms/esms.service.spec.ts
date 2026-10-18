import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EsmsService } from './esms.service.js';

function createService(config: Record<string, string | undefined>) {
  const configService = {
    get: vi.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  return new EsmsService(configService);
}

describe('EsmsService SMS_MODE', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['development', 'test'])(
    'uses mock mode without calling eSMS in %s',
    async (nodeEnv) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const service = createService({ SMS_MODE: 'mock', NODE_ENV: nodeEnv });

      const result = await service.sendSMS('0908 123 456', '654321');

      expect(result).toMatchObject({ CodeResult: '100', IsMock: true });
      expect(result.SMSID).toMatch(/^mock-/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects mock mode in production without calling eSMS', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService({ SMS_MODE: 'mock', NODE_ENV: 'production' });

    await expect(service.sendSMS('0908123456', '654321')).rejects.toThrow(
      'SMS mock chỉ được phép trong môi trường development hoặc test',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown SMS mode', async () => {
    const service = createService({ SMS_MODE: 'disabled', NODE_ENV: 'development' });

    await expect(service.sendSMS('0908123456', '654321')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('does not write phone, OTP, gateway response, or reference into provider logs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ CodeResult: '100', ErrorMessage: '', SMSID: 'ref-1' }),
        ),
      }),
    );
    const service = createService({
      SMS_MODE: 'esms',
      NODE_ENV: 'production',
      ESMS_API_KEY: 'test-api-key',
      ESMS_SECRET_KEY: 'test-secret-key',
    });
    const logger = (service as any).logger;
    const debugSpy = vi.spyOn(logger, 'debug');
    const logSpy = vi.spyOn(logger, 'log');
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    await service.sendSMS('0908123456', '654321');

    expect(debugSpy).toHaveBeenCalled();
    const emitted = [debugSpy, logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .join(' ');
    expect(emitted).not.toContain('0908123456');
    expect(emitted).not.toContain('654321');
    expect(emitted).not.toContain('ref-1');
    expect(emitted).not.toContain('ErrorMessage');
  });
});
