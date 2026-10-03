import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service.js';

@Injectable()
export class LoginSecurityService {
  constructor(private readonly redisService: RedisService) {}

  private getFailKey(userId: string): string {
    return `auth:login-fail:${userId}`;
  }

  private getLockKey(userId: string): string {
    return `auth:login-lock:${userId}`;
  }

  async getTemporaryLockTtl(userId: string): Promise<number> {
    const lockKey = this.getLockKey(userId);
    const client = this.redisService.getClient();
    return await client.ttl(lockKey); // Returns > 0 if exists, -1 if no TTL, -2 if not exists
  }

  async recordFailure(userId: string): Promise<number> {
    const failKey = this.getFailKey(userId);
    const client = this.redisService.getClient();
    return await client.incr(failKey);
  }

  async createTemporaryLock(userId: string, seconds: number): Promise<void> {
    const lockKey = this.getLockKey(userId);
    const client = this.redisService.getClient();
    await client.setex(lockKey, seconds, 'locked');
  }

  async clear(userId: string): Promise<void> {
    const failKey = this.getFailKey(userId);
    const lockKey = this.getLockKey(userId);
    const client = this.redisService.getClient();
    await client.del(failKey, lockKey);
  }
}
