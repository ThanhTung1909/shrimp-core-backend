import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service.js';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  // Lua script ensuring atomic INCR, conditional EXPIRE on creation, and TTL retrieval
  private readonly rateLimitScript = `
    local key = KEYS[1]
    local limit = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])

    local current = redis.call('INCR', key)
    if current == 1 then
      redis.call('EXPIRE', key, window)
    end

    local ttl = redis.call('TTL', key)
    if ttl < 0 then
      redis.call('EXPIRE', key, window)
      ttl = window
    end

    local allowed = 0
    if current <= limit then
      allowed = 1
    end

    return { allowed, current, ttl }
  `;

  constructor(private readonly redisService: RedisService) {}

  /**
   * Kiểm tra và áp dụng rate limit nguyên tử (atomic) bằng Redis Lua script.
   *
   * @param key Định danh của rate limit (ví dụ: rl:login:ip:127.0.0.1)
   * @param limit Số lượng request tối đa được phép trong khung thời gian
   * @param windowSeconds Kích thước khung thời gian tính bằng giây
   * @returns RateLimitResult chứa trạng thái được phép, số lần đã gọi, số lần còn lại và thời gian chờ
   */
  async checkLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new BadRequestException('Rate limit key phải là chuỗi không rỗng!');
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new BadRequestException('Rate limit phải là số nguyên dương lớn hơn 0!');
    }

    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
      throw new BadRequestException('windowSeconds phải là số nguyên dương lớn hơn 0!');
    }

    const client = this.redisService.getClient();
    if (!client) {
      throw new Error('[RateLimitService] Redis client chưa được khởi tạo!');
    }

    try {
      // Execute Lua script atomically
      const result = (await client.eval(
        this.rateLimitScript,
        1,
        key.trim(),
        limit,
        windowSeconds,
      )) as [number, number, number];

      const allowed = result[0] === 1;
      const count = Number(result[1]);
      const ttl = Number(result[2]);
      const remaining = Math.max(0, limit - count);
      const retryAfterSeconds = allowed ? 0 : Math.max(1, ttl);

      return {
        allowed,
        count,
        remaining,
        retryAfterSeconds,
      };
    } catch (error: any) {
      this.logger.error(
        `[RateLimitService] Lỗi khi thực thi rate limit trên key "${key}": ${error.message}`,
      );
      // TUYỆT ĐỐI KHÔNG trả về { allowed: true } khi Redis lỗi! Phải rethrow error để bảo đảm an ninh
      throw error;
    }
  }

  /**
   * Đặt lại (reset) counter cho một key cụ thể nếu cần.
   */
  async resetLimit(key: string): Promise<void> {
    if (!key) return;
    await this.redisService.del(key);
  }
}