import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureHttpApp } from '../src/http-app.config.js';
import {
  HTTP_ONLY_MODE_ENV,
  createDatabaseStartupOptions,
  isHttpOnlyMode,
  isReadOnlyHttpMethod,
} from '../src/common/runtime/http-only-mode.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js';

const originalMode = process.env[HTTP_ONLY_MODE_ENV];

@Controller('http-only-test')
class HttpOnlyTestController {
  static postCalls = 0;

  @Get()
  get() {
    return { ok: true };
  }

  @Post()
  post() {
    HttpOnlyTestController.postCalls += 1;
    return { mutated: true };
  }
}

afterEach(() => {
  if (originalMode === undefined) delete process.env[HTTP_ONLY_MODE_ENV];
  else process.env[HTTP_ONLY_MODE_ENV] = originalMode;
  HttpOnlyTestController.postCalls = 0;
  vi.restoreAllMocks();
});

describe('AQS-203 HTTP-only runtime mode', () => {
  it('is disabled by default and enabled only by the explicit true override', () => {
    delete process.env[HTTP_ONLY_MODE_ENV];
    expect(isHttpOnlyMode()).toBe(false);
    expect(isHttpOnlyMode('false')).toBe(false);
    expect(isHttpOnlyMode('TRUE')).toBe(true);
  });

  it('admits only read-only HTTP methods', () => {
    expect(['GET', 'HEAD', 'OPTIONS'].every(isReadOnlyHttpMethod)).toBe(true);
    expect(isReadOnlyHttpMethod('POST')).toBe(false);
    expect(isReadOnlyHttpMethod('PATCH')).toBe(false);
    expect(isReadOnlyHttpMethod('DELETE')).toBe(false);
  });

  it('pins TypeORM away from schema synchronization, migrations, and schema drops', () => {
    const config = {
      get: vi.fn((key: string) => (key === 'DB_SYNCHRONIZE' ? 'true' : undefined)),
    };

    const options = createDatabaseStartupOptions(config, true);

    expect(options).toMatchObject({
      synchronize: false,
      migrationsRun: false,
      dropSchema: false,
    });
  });

  it('blocks mutations before a controller or Redis rate limiter can run', async () => {
    process.env[HTTP_ONLY_MODE_ENV] = 'true';
    const rateLimitService = { checkLimit: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [HttpOnlyTestController],
      providers: [{ provide: RateLimitService, useValue: rateLimitService }],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureHttpApp(app);
    await app.init();

    try {
      await request(app.getHttpServer()).get('/http-only-test').expect(200);
      const blocked = await request(app.getHttpServer()).post('/http-only-test').expect(405);

      expect(blocked.headers.allow).toBe('GET, HEAD, OPTIONS');
      expect(HttpOnlyTestController.postCalls).toBe(0);
      expect(rateLimitService.checkLimit).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('skips Timescale startup initialization', async () => {
    process.env[HTTP_ONLY_MODE_ENV] = 'true';
    const dataSource = { createQueryRunner: vi.fn() };
    const service = new TelemetryService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      dataSource as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.onModuleInit();

    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('does not register MQTT, gateway, cron, notification, or BullMQ processor providers', async () => {
    process.env[HTTP_ONLY_MODE_ENV] = 'true';
    vi.resetModules();

    const [{ TelemetryModule }, telemetry, { NotificationsModule }, notifications, { PredictionsModule }, predictions] = await Promise.all([
      import('../src/modules/telemetry/telemetry.module.js'),
      import('../src/modules/telemetry/telemetry-mqtt.service.js'),
      import('../src/modules/notifications/notifications.module.js'),
      import('../src/modules/notifications/notification.processor.js'),
      import('../src/modules/predictions/predictions.module.js'),
      import('../src/modules/predictions/processors/prediction.processor.js'),
    ]);
    const { DeviceHealthService } = await import('../src/modules/telemetry/device-health.service.js');
    const { TelemetryGateway } = await import('../src/modules/telemetry/telemetry.gateway.js');
    const { AlertNotificationListener } = await import('../src/modules/notifications/alert-notification.listener.js');
    const { PredictionQueueProcessor } = predictions;

    const telemetryProviders = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TelemetryModule);
    const notificationProviders = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, NotificationsModule);
    const predictionProviders = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PredictionsModule);

    expect(telemetryProviders).not.toContain(telemetry.TelemetryMqttService);
    expect(telemetryProviders).not.toContain(DeviceHealthService);
    expect(telemetryProviders).not.toContain(TelemetryGateway);
    expect(notificationProviders).not.toContain(AlertNotificationListener);
    expect(notificationProviders).not.toContain(notifications.NotificationQueueProcessor);
    expect(predictionProviders).not.toContain(PredictionQueueProcessor);
  }, 20_000);
});
