import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service.js';

@Injectable()
export class LoginSecurityService {
  constructor(private readonly redisService: RedisService) {}

  private failedKey(userId: string): string {
    return `auth:login-fail:${userId}`;
  }

  private lockKey(userId: string): string {
    return `auth:login-lock:${userId}`;
  }

  async getTemporaryLockTtl(userId: string): Promise<number> {
    return this.redisService.ttl(this.lockKey(userId));
  }

  async recordFailure(userId: string): Promise<number> {
    return this.redisService.incr(this.failedKey(userId));
  }

  async createTemporaryLock(userId: string, seconds: number): Promise<void> {
    await this.redisService.setEx(this.lockKey(userId), seconds, '1');
  }

  async clear(userId: string): Promise<void> {
    await this.redisService.del(this.failedKey(userId), this.lockKey(userId));
  }
}
