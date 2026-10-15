import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { configureHttpApp } from '../src/http-app.config.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { RedisService } from '../src/common/redis/redis.service.js';
import { RedisThrottlerStorage } from '../src/common/redis/redis-throttler.storage.js';

@Controller('p0-4-rest')
class RestTestController {
  @Get()
  get() {
    return { ok: true };
  }
}

@Controller('p0-4-auth')
@Throttle({ default: { limit: 5, ttl: 60_000 } })
class AuthTestController {
  @Get()
  get() {
    return { ok: true };
  }
}

function createSwaggerRateLimitService() {
  const counters = new Map<string, number>();
  return {
    async checkLimit(key: string, limit: number) {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return {
        allowed: count <= limit,
        count,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: count <= limit ? 0 : 60,
      };
    },
  };
}

async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([
        {
          ttl: 60_000,
          limit: 60,
        },
      ]),
    ],
    controllers: [RestTestController, AuthTestController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      {
        provide: RateLimitService,
        useValue: createSwaggerRateLimitService(),
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureHttpApp(app);
  SwaggerModule.setup(
    'api/docs',
    app,
    () => SwaggerModule.createDocument(app, new DocumentBuilder().build()),
  );
  await app.init();
  return app;
}

describe('P0-4 HTTP security hardening', () => {
  it('sets Helmet headers on a REST controller response', async () => {
    const app = await createTestApp();
    try {
      const response = await request(app.getHttpServer()).get('/p0-4-rest');
      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    } finally {
      await app.close();
    }
  });

  it('allows 60 REST requests then returns 429', async () => {
    const app = await createTestApp();
    try {
      for (let index = 0; index < 60; index += 1) {
        await request(app.getHttpServer()).get('/p0-4-rest').expect(200);
      }
      await request(app.getHttpServer()).get('/p0-4-rest').expect(429);
    } finally {
      await app.close();
    }
  }, 20_000);

  it('uses the Auth override: five requests then 429', async () => {
    const app = await createTestApp();
    try {
      for (let index = 0; index < 5; index += 1) {
        await request(app.getHttpServer()).get('/p0-4-auth').expect(200);
      }
      await request(app.getHttpServer()).get('/p0-4-auth').expect(429);
    } finally {
      await app.close();
    }
  });

  it('rate-limits Swagger JSON without changing controller quotas', async () => {
    const app = await createTestApp();
    try {
      for (let index = 0; index < 60; index += 1) {
        await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      }
      const blocked = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(429);
      expect(blocked.headers['retry-after']).toBe('60');

      // Swagger's dedicated middleware must not consume the REST quota.
      await request(app.getHttpServer()).get('/p0-4-rest').expect(200);
    } finally {
      await app.close();
    }
  }, 20_000);

  it('uses the trusted proxy client identity consistently', async () => {
    const app = await createTestApp();
    try {
      for (let index = 0; index < 60; index += 1) {
        await request(app.getHttpServer())
          .get('/p0-4-rest')
          .set('X-Forwarded-For', '198.51.100.18')
          .expect(200);
      }
      await request(app.getHttpServer())
        .get('/p0-4-rest')
        .set('X-Forwarded-For', '198.51.100.18')
        .expect(429);
    } finally {
      await app.close();
    }
  }, 20_000);
});

const redisIntegration = process.env.P0_4_REDIS_INTEGRATION === 'true' ? it : it.skip;

describe('P0-4 shared Redis throttler storage', () => {
  it('fails closed when Redis is unavailable', async () => {
    const storage = new RedisThrottlerStorage({
      getClient: () => ({ status: 'end' }),
    } as any);

    await expect(
      storage.increment('unavailable', 60_000, 60, 60_000, 'default'),
    ).rejects.toMatchObject({ status: 503 });
  });

  redisIntegration(
    'shares counters between storage instances and recovers after the TTL',
    async () => {
      const redisService = new RedisService({
        get: (key: string) => {
          const values: Record<string, string | number | undefined> = {
            REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
            REDIS_PORT: process.env.REDIS_PORT || 6379,
            REDIS_PASSWORD: process.env.REDIS_PASSWORD,
            REDIS_DB: process.env.REDIS_DB || 0,
          };
          return values[key];
        },
      } as any);
      const key = `p0-4-test:${Date.now()}`;
      const firstInstance = new RedisThrottlerStorage(redisService);
      const secondInstance = new RedisThrottlerStorage(redisService);

      await redisService.onModuleInit();
      try {
        await expect(redisService.getClient().ping()).resolves.toBe('PONG');

        const first = await firstInstance.increment(key, 100, 1, 100, 'default');
        expect(first).toMatchObject({ totalHits: 1, isBlocked: false });

        const blocked = await secondInstance.increment(key, 100, 1, 100, 'default');
        expect(blocked.isBlocked).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 125));
        const recovered = await firstInstance.increment(key, 100, 1, 100, 'default');
        expect(recovered).toMatchObject({ totalHits: 1, isBlocked: false });
      } finally {
        await redisService.getClient().del(
          `throttle:default:${key}:hits`,
          `throttle:default:${key}:blocked`,
        );
        await redisService.onModuleDestroy();
      }
    },
    10_000,
  );
});
