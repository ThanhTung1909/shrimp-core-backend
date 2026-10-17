import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { RedisService } from './redis.service.js';

/**
 * Distributed storage for Nest's ThrottlerGuard.
 *
 * Redis errors are deliberately surfaced as 503 responses by the guard's
 * request pipeline; falling back to process memory would weaken the limit in
 * a multi-instance deployment.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private static readonly incrementScript = `
    local hitsKey = KEYS[1]
    local blockedKey = KEYS[2]
    local ttl = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local blockDuration = tonumber(ARGV[3])

    local blockTtl = redis.call('PTTL', blockedKey)
    if blockTtl > 0 then
      local existingHits = tonumber(redis.call('GET', hitsKey) or '0')
      local existingTtl = redis.call('PTTL', hitsKey)
      return { existingHits, math.max(existingTtl, 0), 1, blockTtl }
    end

    local totalHits = redis.call('INCR', hitsKey)
    if totalHits == 1 then
      redis.call('PEXPIRE', hitsKey, ttl)
    end

    local timeToExpire = redis.call('PTTL', hitsKey)
    if totalHits > limit then
      redis.call('SET', blockedKey, '1', 'PX', blockDuration)
      return { totalHits, math.max(timeToExpire, 0), 1, blockDuration }
    end

    return { totalHits, math.max(timeToExpire, 0), 0, 0 }
  `;

  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const client = this.getReadyClient();
    const baseKey = `throttle:${throttlerName}:${key}`;
    const result = (await client.eval(
      RedisThrottlerStorage.incrementScript,
      2,
      `${baseKey}:hits`,
      `${baseKey}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits: Number(result[0]),
      timeToExpire: Number(result[1]),
      isBlocked: Number(result[2]) === 1,
      timeToBlockExpire: Number(result[3]),
    };
  }

  private getReadyClient(): Redis {
    const client = this.redisService.getClient();
    if (!client || client.status !== 'ready') {
      throw new ServiceUnavailableException('Rate-limit storage is unavailable');
    }
    return client;
  }
}
