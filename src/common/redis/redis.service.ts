import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = Number(this.configService.get<number>('REDIS_PORT')) || 6379;
    const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;
    const db = Number(this.configService.get<number>('REDIS_DB')) || 0;

    this.client = new Redis({
      host,
      port,
      password,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 5) {
          return null; // Dừng retry nếu vượt quá 5 lần thử lại
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.client.on('connect', () => {
      this.logger.log(`[Redis] Đang kết nối tới ${host}:${port} (DB: ${db})...`);
    });

    this.client.on('ready', () => {
      this.logger.log(`[Redis] Kết nối thành công và đã sẵn sàng nhận lệnh tại ${host}:${port}.`);
    });

    this.client.on('error', (err: Error) => {
      this.logger.error(`[Redis Error] Lỗi kết nối Redis: ${err.message}`);
    });

    try {
      await this.client.connect();
    } catch (err: any) {
      this.logger.error(
        `[Redis] Không thể kết nối tới Redis server tại ${host}:${port}: ${err.message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.log('[Redis] Đã ngắt kết nối Redis an toàn.');
      } catch (err: any) {
        this.logger.warn(`[Redis] Lỗi khi ngắt kết nối: ${err.message}`);
        this.client.disconnect();
      }
    }
  }

  /**
   * Trả về ioredis client gốc nếu cần thực hiện lệnh nâng cao.
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Lấy giá trị chuỗi của key.
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Gán giá trị chuỗi cho key, hỗ trợ TTL tùy chọn theo giây.
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (ttlSeconds && ttlSeconds > 0) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  /**
   * Gán giá trị chuỗi cho key kèm thời gian sống (TTL) tính bằng giây.
   */
  async setEx(key: string, seconds: number, value: string): Promise<'OK'> {
    return (await this.client.setex(key, seconds, value)) as 'OK';
  }

  /**
   * Xóa một hoặc nhiều key khỏi Redis.
   */
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  /**
   * Tăng giá trị số của key lên 1 đơn vị.
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Thiết lập thời gian sống (TTL) cho key tính bằng giây.
   */
  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  /**
   * Lấy thời gian sống còn lại (TTL) của key tính bằng giây.
   * - -2 nếu key không tồn tại.
   * - -1 nếu key tồn tại nhưng không có hạn sử dụng.
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Kiểm tra sự tồn tại của một hoặc nhiều key.
   * Trả về số lượng key thực sự tồn tại.
   */
  async exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.exists(...keys);
  }
}