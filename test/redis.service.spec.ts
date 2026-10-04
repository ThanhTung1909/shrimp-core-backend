import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../src/common/redis/redis.service.js';

describe('REDIS SERVICE INFRASTRUCTURE SUITE', () => {
  let redisService: RedisService;
  let configService: ConfigService;
  const testPrefix = `test:infra:${Date.now()}:`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const keys = await client.keys(`${testPrefix}*`);
      if (keys.length > 0) {
        await redisService.del(...keys);
      }
    }
    await redisService.onModuleDestroy();
  });

  it('1. set and get operation', async () => {
    const key = `${testPrefix}key1`;
    await redisService.set(key, 'hello-redis');
    const val = await redisService.get(key);
    expect(val).toBe('hello-redis');
  });

  it('2. exists operation', async () => {
    const key = `${testPrefix}key2`;
    await redisService.set(key, 'exists-val');
    const exists = await redisService.exists(key);
    expect(exists).toBe(1);

    const notExists = await redisService.exists(`${testPrefix}non-existent`);
    expect(notExists).toBe(0);
  });

  it('3. incr operation', async () => {
    const key = `${testPrefix}counter`;
    const val1 = await redisService.incr(key);
    expect(val1).toBe(1);

    const val2 = await redisService.incr(key);
    expect(val2).toBe(2);
  });

  it('4. expire and ttl operation', async () => {
    const key = `${testPrefix}expiring`;
    await redisService.set(key, 'temp-val');
    await redisService.expire(key, 60);

    const ttl = await redisService.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('5. setEx operation with TTL', async () => {
    const key = `${testPrefix}setex`;
    await redisService.setEx(key, 120, 'setex-val');

    const val = await redisService.get(key);
    expect(val).toBe('setex-val');

    const ttl = await redisService.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('6. del operation', async () => {
    const key = `${testPrefix}to-delete`;
    await redisService.set(key, 'delete-me');
    const deletedCount = await redisService.del(key);
    expect(deletedCount).toBe(1);

    const val = await redisService.get(key);
    expect(val).toBeNull();
  });
});