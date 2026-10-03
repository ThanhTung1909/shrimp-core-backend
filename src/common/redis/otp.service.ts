import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { RedisService } from './redis.service.js';
import { normalizePhone } from './rate-limit.constants.js';
import {
  OTP_CONFIG,
  getOtpCodeKey,
  getOtpAttemptsKey,
  getOtpVerifiedKey,
} from './otp.constants.js';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  // Lua script ensuring atomic check, compare, attempts increment / invalidate, and verified marker creation
  private readonly verifyScript = `
    local codeKey = KEYS[1]
    local attemptsKey = KEYS[2]
    local verifiedKey = KEYS[3]

    local inputHash = ARGV[1]
    local maxAttempts = tonumber(ARGV[2])
    local verifiedTtl = tonumber(ARGV[3])

    -- 1. Kiểm tra mã OTP có tồn tại trong Redis không
    local storedHash = redis.call('GET', codeKey)
    if not storedHash then
      return { 0, 'NOT_FOUND_OR_EXPIRED', 0 }
    end

    -- 2. Kiểm tra số lần thử hiện tại
    local currentAttempts = tonumber(redis.call('GET', attemptsKey) or '0')
    if currentAttempts >= maxAttempts then
      redis.call('DEL', codeKey, attemptsKey)
      return { 0, 'MAX_ATTEMPTS_EXCEEDED', currentAttempts }
    end

    -- 3. So khớp hash OTP
    if storedHash == inputHash then
      -- Xác thực thành công: OTP chỉ sử dụng một lần (One-Time Use) -> xóa ngay lập tức
      redis.call('DEL', codeKey, attemptsKey)
      -- Đánh dấu trạng thái đã xác thực với TTL
      redis.call('SET', verifiedKey, '1', 'EX', verifiedTtl)
      return { 1, 'SUCCESS', currentAttempts }
    else
      -- Nhập sai: Tăng số lần thử nguyên tử
      local newAttempts = redis.call('INCR', attemptsKey)
      local codeTtl = redis.call('TTL', codeKey)
      if codeTtl > 0 then
        redis.call('EXPIRE', attemptsKey, codeTtl)
      end

      -- Nếu đã đạt ngưỡng 5 lần sai -> xóa hủy mã OTP ngay lập tức
      if newAttempts >= maxAttempts then
        redis.call('DEL', codeKey, attemptsKey)
        return { 0, 'MAX_ATTEMPTS_REACHED', newAttempts }
      else
        return { 0, 'WRONG_OTP', newAttempts }
      end
    end
  `;

  constructor(private readonly redisService: RedisService) {}

  /**
   * Sinh mã OTP ngẫu nhiên gồm đúng 6 chữ số bằng crypto.randomInt an toàn mã hóa.
   */
  generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  /**
   * Băm mã OTP bằng SHA-256 (không lưu plaintext vào Redis).
   */
  hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Tạo mã OTP mới, băm SHA-256 và lưu vào Redis kèm reset attempts về 0.
   *
   * @param phone Số điện thoại nhận OTP
   * @param ttlSeconds Thời gian sống của OTP (mặc định 300s = 5 phút)
   */
  async createAndSaveOtp(
    phone: string,
    ttlSeconds: number = OTP_CONFIG.TTL_SECONDS,
  ): Promise<{ otp: string; otpHash: string }> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException('Số điện thoại không hợp lệ!');
    }

    const otp = this.generateOtp();
    const otpHash = this.hashOtp(otp);

    const codeKey = getOtpCodeKey(normalized);
    const attemptsKey = getOtpAttemptsKey(normalized);

    const client = this.redisService.getClient();
    if (!client) {
      throw new Error('[OtpService] Redis client chưa được khởi tạo!');
    }

    try {
      const pipeline = client.pipeline();
      pipeline.set(codeKey, otpHash, 'EX', ttlSeconds);
      pipeline.set(attemptsKey, '0', 'EX', ttlSeconds);
      const results = await pipeline.exec();

      if (results) {
        for (const [err] of results) {
          if (err) throw err;
        }
      }

      return { otp, otpHash };
    } catch (error: any) {
      this.logger.error(
        `[OtpService] Lỗi khi lưu OTP vào Redis: ${error.message}`,
      );
      // TUYỆT ĐỐI KHÔNG fail-open
      throw error;
    }
  }

  /**
   * Xác thực mã OTP bằng Redis Lua Script nguyên tử chống race condition.
   *
   * @param phone Số điện thoại
   * @param otp Mã OTP gồm 6 chữ số người dùng nhập
   */
  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException('Số điện thoại không hợp lệ!');
    }

    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn!');
    }

    const client = this.redisService.getClient();
    if (!client) {
      throw new Error('[OtpService] Redis client chưa được khởi tạo!');
    }

    const inputHash = this.hashOtp(otp.trim());
    const codeKey = getOtpCodeKey(normalized);
    const attemptsKey = getOtpAttemptsKey(normalized);
    const verifiedKey = getOtpVerifiedKey(normalized);

    try {
      const result = (await client.eval(
        this.verifyScript,
        3,
        codeKey,
        attemptsKey,
        verifiedKey,
        inputHash,
        OTP_CONFIG.MAX_ATTEMPTS,
        OTP_CONFIG.VERIFIED_TTL_SECONDS,
      )) as [number, string, number];

      const status = result[0];
      if (status !== 1) {
        throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn!');
      }

      return true;
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `[OtpService] Lỗi khi xác thực OTP qua Redis: ${error.message}`,
      );
      // TUYỆT ĐỐI KHÔNG fail-open khi Redis gặp sự cố
      throw error;
    }
  }

  /**
   * Kiểm tra trạng thái số điện thoại đã được xác thực thành công trong vòng 10 phút qua.
   */
  async isPhoneVerified(phone: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    const exists = await this.redisService.exists(getOtpVerifiedKey(normalized));
    return exists > 0;
  }

  /**
   * Tiêu thụ (consume) marker xác thực OTP một cách nguyên tử bằng Redis Lua Script.
   * Đảm bảo chỉ duy nhất 1 request có thể tiêu thụ thành công marker này.
   */
  async consumePhoneVerified(phone: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return false;
    }

    const client = this.redisService.getClient();
    if (!client) {
      throw new Error('[OtpService] Redis client chưa được khởi tạo!');
    }

    const verifiedKey = getOtpVerifiedKey(normalized);
    const consumeScript = `
      local key = KEYS[1]
      local val = redis.call('GET', key)
      if val and val == '1' then
        redis.call('DEL', key)
        return 1
      else
        return 0
      end
    `;

    try {
      const result = (await client.eval(consumeScript, 1, verifiedKey)) as number;
      return result === 1;
    } catch (error: any) {
      this.logger.error(
        `[OtpService] Lỗi khi consume verification marker qua Redis: ${error.message}`,
      );
      // TUYỆT ĐỐI KHÔNG fail-open khi Redis gặp sự cố
      throw error;
    }
  }

  /**
   * Đặt marker xác thực cho số điện thoại (phục vụ testing hoặc workflow nâng cao).
   */
  async setPhoneVerified(
    phone: string,
    ttlSeconds: number = OTP_CONFIG.VERIFIED_TTL_SECONDS,
  ): Promise<void> {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    await this.redisService.set(getOtpVerifiedKey(normalized), '1', ttlSeconds);
  }

  /**
   * Khôi phục lại marker xác thực OTP nếu quá trình đăng ký xảy ra lỗi hệ thống / DB.
   */
  async restorePhoneVerified(
    phone: string,
    ttlSeconds: number = OTP_CONFIG.VERIFIED_TTL_SECONDS,
  ): Promise<void> {
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    const verifiedKey = getOtpVerifiedKey(normalized);
    try {
      await this.redisService.set(verifiedKey, '1', ttlSeconds);
    } catch (error: any) {
      this.logger.error(
        `[OtpService] Lỗi khi khôi phục verification marker: ${error.message}`,
      );
    }
  }

  /**
   * Lấy số lần nhập sai hiện tại của OTP (phục vụ testing).
   */
  async getOtpAttempts(phone: string): Promise<number> {
    const normalized = normalizePhone(phone);
    const val = await this.redisService.get(getOtpAttemptsKey(normalized));
    return val !== null ? parseInt(val, 10) : 0;
  }

  /**
   * Lấy hash OTP đang lưu trong Redis (phục vụ testing).
   */
  async getOtpCodeHash(phone: string): Promise<string | null> {
    const normalized = normalizePhone(phone);
    return this.redisService.get(getOtpCodeKey(normalized));
  }
}
