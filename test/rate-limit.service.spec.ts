import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';

describe('RATE LIMIT SERVICE SUITE', () => {
  let redisService: RedisService;
  let rateLimitService: RateLimitService;
  const testPrefix = `test:ratelimit:${Date.now()}:`;

  beforeAll(async () => {
    const configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();

    rateLimitService = new RateLimitService(redisService);
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

  it('1. Request đầu tiên được phép (allowed=true, count=1, remaining=4)', async () => {
    const key = `${testPrefix}req1`;
    const res = await rateLimitService.checkLimit(key, 5, 60);

    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1);
    expect(res.remaining).toBe(4);
    expect(res.retryAfterSeconds).toBe(0);
  });

  it('2 & 3. Count tăng đúng và remaining giảm đúng qua từng request', async () => {
    const key = `${testPrefix}req2`;
    const r1 = await rateLimitService.checkLimit(key, 3, 60);
    expect(r1.count).toBe(1);
    expect(r1.remaining).toBe(2);

    const r2 = await rateLimitService.checkLimit(key, 3, 60);
    expect(r2.count).toBe(2);
    expect(r2.remaining).toBe(1);
  });

  it('4. Đến đúng limit vẫn được phép (count=limit, remaining=0, allowed=true)', async () => {
    const key = `${testPrefix}req4`;
    await rateLimitService.checkLimit(key, 2, 60); // 1
    const res = await rateLimitService.checkLimit(key, 2, 60); // 2 == limit

    expect(res.allowed).toBe(true);
    expect(res.count).toBe(2);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterSeconds).toBe(0);
  });

  it('5 & 6. Request vượt limit bị chặn và retryAfterSeconds > 0', async () => {
    const key = `${testPrefix}req5`;
    await rateLimitService.checkLimit(key, 2, 60); // 1
    await rateLimitService.checkLimit(key, 2, 60); // 2

    // Request thứ 3 vượt limit
    const res = await rateLimitService.checkLimit(key, 2, 60);
    expect(res.allowed).toBe(false);
    expect(res.count).toBe(3);
    expect(res.remaining).toBe(0);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('7. Counter có TTL trong Redis', async () => {
    const key = `${testPrefix}req7`;
    await rateLimitService.checkLimit(key, 5, 30);

    const ttl = await redisService.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('8. Sau khi key hết TTL hoặc được reset, có thể request lại', async () => {
    const key = `${testPrefix}req8`;
    await rateLimitService.checkLimit(key, 1, 1); // Đạt limit ngay lập tức
    const blocked = await rateLimitService.checkLimit(key, 1, 1);
    expect(blocked.allowed).toBe(false);

    // Chờ 1.1s để key hết hạn TTL
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const fresh = await rateLimitService.checkLimit(key, 1, 1);
    expect(fresh.allowed).toBe(true);
    expect(fresh.count).toBe(1);
  });

  it('9. Concurrent requests không làm sai count/limit (10 concurrent requests với limit=5)', async () => {
    const key = `${testPrefix}concurrent`;
    const limit = 5;

    // Gửi đồng thời 10 requests
    const promises = Array.from({ length: 10 }).map(() =>
      rateLimitService.checkLimit(key, limit, 60),
    );

    const results = await Promise.all(promises);

    const allowedRequests = results.filter((r) => r.allowed === true);
    const blockedRequests = results.filter((r) => r.allowed === false);

    expect(allowedRequests).toHaveLength(5);
    expect(blockedRequests).toHaveLength(5);

    // Kiểm tra các giá trị count là duy nhất từ 1 đến 10 do tính nguyên tử (atomic) của Lua script
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('10. Invalid limit bị reject (limit <= 0 hoặc không phải số nguyên)', async () => {
    const key = `${testPrefix}invalid_limit`;
    await expect(rateLimitService.checkLimit(key, 0, 60)).rejects.toThrow(BadRequestException);
    await expect(rateLimitService.checkLimit(key, -5, 60)).rejects.toThrow(BadRequestException);
    await expect(rateLimitService.checkLimit(key, 2.5, 60)).rejects.toThrow(BadRequestException);
  });

  it('11. Invalid window bị reject (windowSeconds <= 0 hoặc không phải số nguyên)', async () => {
    const key = `${testPrefix}invalid_window`;
    await expect(rateLimitService.checkLimit(key, 5, 0)).rejects.toThrow(BadRequestException);
    await expect(rateLimitService.checkLimit(key, 5, -10)).rejects.toThrow(BadRequestException);
    await expect(rateLimitService.checkLimit(key, 5, 3.14)).rejects.toThrow(BadRequestException);
  });

  it('12. Redis error không được biến thành allowed=true mà phải throw error', async () => {
    // Tạo một mock RedisService ném lỗi
    const failingRedisService = {
      getClient: () => ({
        eval: () => Promise.reject(new Error('Connection lost to Redis')),
      }),
    } as any;

    const brokenRateLimitService = new RateLimitService(failingRedisService);

    await expect(
      brokenRateLimitService.checkLimit('test:fail', 5, 60),
    ).rejects.toThrow('Connection lost to Redis');
  });
});