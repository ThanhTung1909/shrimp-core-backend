import { OtpPurpose } from '../src/common/redis/otp.constants.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import {
  OTP_CONFIG,
  getOtpCodeKey,
  getOtpAttemptsKey,
  getOtpVerifiedKey,
} from '../src/common/redis/otp.constants.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

describe('OTP SECURITY WITH REDIS SUITE', () => {
  let redisService: RedisService;
  let otpService: OtpService;
  let authService: AuthService;
  let usersService: any;

  const testId = Date.now();
  let phoneSeq = 1000;
  const getNextPhone = () => `097${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    const configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    otpService = new OtpService(redisService);
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const keys = await client.keys('otp:*:097*');
      if (keys.length > 0) {
        await redisService.del(...keys);
      }
    }
    await redisService.onModuleDestroy();
  });

  beforeEach(() => {
    usersService = {
      findByPhoneNumber: vi.fn().mockResolvedValue(null),
    };

    authService = new AuthService(
      usersService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { sendInitialPassword: vi.fn() } as any,
      { sendSMS: vi.fn() } as any,
      otpService,
    );
  });

  describe('1. OTP Generation & Format', () => {
    it('Test 1 — OTP format: exactly 6 numeric digits between 100000 and 999999', () => {
      for (let i = 0; i < 50; i++) {
        const otp = otpService.generateOtp();
        expect(otp).toHaveLength(6);
        expect(/^\d{6}$/.test(otp)).toBe(true);
        const num = parseInt(otp, 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThan(1000000);
      }
    });

    it('Test 2 — OTP is random and not hard-coded', () => {
      const otps = new Set<string>();
      for (let i = 0; i < 30; i++) {
        otps.add(otpService.generateOtp());
      }
      // With 6 random digits, 30 generations will yield at least 25 unique values
      expect(otps.size).toBeGreaterThanOrEqual(25);
      expect(otps.has('123456')).toBe(false); // Not hard-coded to 123456
    });
  });

  describe('2. Redis Storage, Hashing & TTL', () => {
    it('Test 3 — Redis stores SHA-256 hash (64 hex characters), not plaintext OTP', async () => {
      const phone = getNextPhone();
      const { otp, otpHash } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      const stored = await otpService.getOtpCodeHash(OtpPurpose.REGISTER, phone);
      expect(stored).not.toBeNull();
      expect(stored).not.toBe(otp); // Plaintext is NOT stored
      expect(stored).toBe(otpHash);
      expect(stored).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(stored!)).toBe(true);
    });

    it('Test 4 — OTP TTL is set to 300s (5 minutes)', async () => {
      const phone = getNextPhone();
      await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      const ttl = await redisService.ttl(getOtpCodeKey(OtpPurpose.REGISTER, phone));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(OTP_CONFIG.TTL_SECONDS);
    });

    it('Test 5 — Attempts starts at zero and has TTL', async () => {
      const phone = getNextPhone();
      await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      const attempts = await otpService.getOtpAttempts(OtpPurpose.REGISTER, phone);
      expect(attempts).toBe(0);

      const attemptsTtl = await redisService.ttl(getOtpAttemptsKey(OtpPurpose.REGISTER, phone));
      expect(attemptsTtl).toBeGreaterThan(0);
      expect(attemptsTtl).toBeLessThanOrEqual(OTP_CONFIG.TTL_SECONDS);
    });
  });

  describe('3. Verification Flow & One-Time Use', () => {
    it('Test 6 — Correct OTP succeeds, deletes code and attempts, and sets verified marker', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      const result = await otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp);
      expect(result).toBe(true);

      // OTP key and attempts must be deleted immediately
      expect(await redisService.exists(getOtpCodeKey(OtpPurpose.REGISTER, phone))).toBe(0);
      expect(await redisService.exists(getOtpAttemptsKey(OtpPurpose.REGISTER, phone))).toBe(0);

      // Verified marker must exist with TTL <= 600s
      const verified = await otpService.isPhoneVerified(OtpPurpose.REGISTER, phone);
      expect(verified).toBe(true);

      const markerTtl = await redisService.ttl(getOtpVerifiedKey(OtpPurpose.REGISTER, phone));
      expect(markerTtl).toBeGreaterThan(0);
      expect(markerTtl).toBeLessThanOrEqual(OTP_CONFIG.VERIFIED_TTL_SECONDS);
    });

    it('Test 7 — Correct OTP is one-time use (second verify fails)', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      // First verification succeeds
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp)).resolves.toBe(true);

      // Second verification with the same OTP must FAIL
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp)).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Wrong Attempts & Invalidation', () => {
    it('Test 8 — Wrong OTP increments attempts counter (1..4)', async () => {
      const phone = getNextPhone();
      await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      for (let attempt = 1; attempt <= 4; attempt++) {
        await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, '000000')).rejects.toThrow(BadRequestException);
        const count = await otpService.getOtpAttempts(OtpPurpose.REGISTER, phone);
        expect(count).toBe(attempt);
      }
    });

    it('Test 9 — Fifth wrong attempt invalidates and deletes OTP and attempts key', async () => {
      const phone = getNextPhone();
      await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      // 4 wrong attempts
      for (let i = 1; i <= 4; i++) {
        await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, '000000')).rejects.toThrow(BadRequestException);
      }

      // 5th wrong attempt -> triggers deletion
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, '000000')).rejects.toThrow(BadRequestException);

      // Code and attempts keys must be deleted
      expect(await redisService.exists(getOtpCodeKey(OtpPurpose.REGISTER, phone))).toBe(0);
      expect(await redisService.exists(getOtpAttemptsKey(OtpPurpose.REGISTER, phone))).toBe(0);
    });

    it('Test 10 — Sixth attempt cannot work even with correct OTP', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      // 5 wrong attempts
      for (let i = 1; i <= 5; i++) {
        await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, '000000')).rejects.toThrow(BadRequestException);
      }

      // 6th attempt with the CORRECT OTP must still fail
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp)).rejects.toThrow(BadRequestException);
    });

    it('Test 11 — New OTP resets attempts to 0 and replaces old OTP', async () => {
      const phone = getNextPhone();
      const { otp: otpA } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      // 2 wrong attempts on OTP A
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, '000000')).rejects.toThrow(BadRequestException);
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, '000000')).rejects.toThrow(BadRequestException);
      expect(await otpService.getOtpAttempts(OtpPurpose.REGISTER, phone)).toBe(2);

      // Send new OTP B for the same phone
      const { otp: otpB } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      // Attempts must be reset to 0
      expect(await otpService.getOtpAttempts(OtpPurpose.REGISTER, phone)).toBe(0);

      // Old OTP A must no longer work
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, otpA)).rejects.toThrow(BadRequestException);

      // New OTP B must succeed
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, otpB)).resolves.toBe(true);
    });
  });

  describe('5. Expiration & Isolation', () => {
    it('Test 12 — Expired OTP cannot be verified', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone, 1); // 1s TTL

      // Wait 1.1s for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp)).rejects.toThrow(BadRequestException);
    });

    it('Test 13 — Verified marker TTL is between 0 and 600s', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      await otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp);

      const ttl = await redisService.ttl(getOtpVerifiedKey(OtpPurpose.REGISTER, phone));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('Test 14 — Different phones are strictly isolated', async () => {
      const phoneA = getNextPhone();
      const phoneB = getNextPhone();

      const { otp: otpA } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phoneA);
      const { otp: otpB } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phoneB);

      // Verifying A does not affect B
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phoneA, otpA)).resolves.toBe(true);

      // B is still intact and can be verified
      expect(await redisService.exists(getOtpCodeKey(OtpPurpose.REGISTER, phoneB))).toBe(1);
      await expect(otpService.verifyOtp(OtpPurpose.REGISTER, phoneB, otpB)).resolves.toBe(true);
    });
  });

  describe('6. Concurrency & Fail-Closed Behavior', () => {
    it('Test 15 — Concurrent verification cannot both succeed (exactly 1 success, 1 failure)', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.REGISTER, phone);

      // Fire 2 concurrent verification requests for the exact same OTP
      const results = await Promise.allSettled([
        otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp),
        otpService.verifyOtp(OtpPurpose.REGISTER, phone, otp),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });

    it('Test 16 — Redis failure propagates and does NOT fail-open', async () => {
      const brokenRedisService = {
        getClient: () => ({
          eval: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
          pipeline: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            exec: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
          }),
        }),
      } as unknown as RedisService;

      const failingOtpService = new OtpService(brokenRedisService);

      // Send OTP failure must throw, not succeed
      await expect(
        failingOtpService.createAndSaveOtp(OtpPurpose.REGISTER, '0912345678'),
      ).rejects.toThrow('Redis connection lost');

      // Verify OTP failure must throw, not return true
      await expect(
        failingOtpService.verifyOtp(OtpPurpose.REGISTER, '0912345678', '123456'),
      ).rejects.toThrow('Redis connection lost');
    });
  });

  describe('7. End-to-End AuthService Integration', () => {
    it('Test 17 — AuthService sendOtp and verifyOtp works seamlessly with OtpService', async () => {
      const phone = getNextPhone();

      const sendRes = await authService.sendOtp({ phoneNumber: phone, purpose: OtpPurpose.REGISTER });
      expect(sendRes.message).toBe('Mã OTP đã được gửi thành công!');
      expect(sendRes.phoneNumber).toBe(phone);
      expect(sendRes.expiresIn).toBe('5 phút');
      expect(sendRes.otp).toBeDefined();

      const verifyRes = await authService.verifyOtp({ phoneNumber: phone, otp: sendRes.otp!, purpose: OtpPurpose.REGISTER });
      expect(verifyRes.message).toBe('Xác thực OTP thành công!');
      expect(verifyRes.isValid).toBe(true);

      // One-time check: verifying again throws BadRequestException
      await expect(
        authService.verifyOtp({ phoneNumber: phone, otp: sendRes.otp!, purpose: OtpPurpose.REGISTER }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
