import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import {
  RATE_LIMIT_CONFIG,
  normalizeIp,
  normalizePhone,
} from '../src/common/redis/rate-limit.constants.js';

describe('AUTH RATE LIMIT INTEGRATION SUITE', () => {
  let redisService: RedisService;
  let rateLimitService: RateLimitService;
  let authService: any;
  let usersService: any;
  let authController: AuthController;

  const testId = Date.now();
  let ipCounter = 1;
  let phoneCounter = 1000;

  const getNextIp = () => `192.168.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const getNextPhone = () => `098${testId.toString().slice(-4)}${(phoneCounter++).toString().padStart(4, '0')}`;

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
      const keys = await client.keys('rl:*');
      if (keys.length > 0) {
        await redisService.del(...keys);
      }
    }
    await redisService.onModuleDestroy();
  });

  beforeEach(() => {
    authService = {
      login: vi.fn().mockResolvedValue({ accessToken: 'mock-access', refreshToken: 'mock-refresh' }),
      refreshToken: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      register: vi.fn().mockResolvedValue({ message: 'Đăng ký thành công', userId: 'mock-id' }),
      sendOtp: vi.fn().mockResolvedValue({ message: 'Mã OTP đã được gửi', otp: '123456' }),
      verifyOtp: vi.fn().mockResolvedValue({ message: 'Xác thực OTP thành công', isValid: true }),
    };

    usersService = {};
    authController = new AuthController(authService, usersService, rateLimitService);
  });

  describe('1. Login Rate Limiting', () => {
    it('IP limit: 1..10 requests allowed, 11th blocked with 429', async () => {
      const ip = getNextIp();
      const loginDto = { phoneNumber: getNextPhone(), password: 'Password123!' };

      // Requests 1..10 should be allowed
      for (let i = 1; i <= RATE_LIMIT_CONFIG.LOGIN.IP_LIMIT; i++) {
        // Dùng số điện thoại khác nhau để chỉ test rate limit theo IP
        const res = await authController.login(
          { phoneNumber: getNextPhone(), password: 'Password123!' },
          ip,
        );
        expect(res).toBeDefined();
      }
      expect(authService.login).toHaveBeenCalledTimes(10);

      // Request 11 should be blocked with 429
      try {
        await authController.login(loginDto, ip);
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      // Business logic must NOT be called on blocked request
      expect(authService.login).toHaveBeenCalledTimes(10);
    });

    it('Phone limit: 1..5 requests allowed, 6th blocked with 429', async () => {
      const phone = getNextPhone();
      const loginDto = { phoneNumber: phone, password: 'Password123!' };

      // Requests 1..5 should be allowed (từ các IP khác nhau để chỉ test phone limit)
      for (let i = 1; i <= RATE_LIMIT_CONFIG.LOGIN.PHONE_LIMIT; i++) {
        const res = await authController.login(loginDto, getNextIp());
        expect(res).toBeDefined();
      }
      expect(authService.login).toHaveBeenCalledTimes(5);

      // Request 6 should be blocked with 429
      try {
        await authController.login(loginDto, getNextIp());
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      // Downstream logic not called on blocked request
      expect(authService.login).toHaveBeenCalledTimes(5);
    });
  });

  describe('2. Refresh Token Rate Limiting', () => {
    it('IP limit: 1..30 requests allowed, 31st blocked with 429', async () => {
      const ip = getNextIp();
      const refreshDto = { refreshToken: 'dummy-refresh-token' };

      for (let i = 1; i <= RATE_LIMIT_CONFIG.REFRESH.IP_LIMIT; i++) {
        const res = await authController.refreshToken(refreshDto, ip);
        expect(res).toBeDefined();
      }
      expect(authService.refreshToken).toHaveBeenCalledTimes(30);

      try {
        await authController.refreshToken(refreshDto, ip);
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      expect(authService.refreshToken).toHaveBeenCalledTimes(30);
    });
  });

  describe('3. Register Rate Limiting', () => {
    it('IP limit: 1..5 requests allowed, 6th blocked with 429', async () => {
      const ip = getNextIp();

      for (let i = 1; i <= RATE_LIMIT_CONFIG.REGISTER.IP_LIMIT; i++) {
        const registerDto = {
          fullName: `User ${i}`,
          phoneNumber: getNextPhone(),
          password: 'Password123!',
        };
        const res = await authController.register(registerDto, ip);
        expect(res).toBeDefined();
      }
      expect(authService.register).toHaveBeenCalledTimes(5);

      try {
        await authController.register(
          { fullName: 'Blocked User', phoneNumber: getNextPhone(), password: 'Password123!' },
          ip,
        );
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      expect(authService.register).toHaveBeenCalledTimes(5);
    });
  });

  describe('4. Send OTP Rate Limiting', () => {
    it('Phone limit: 1 request allowed, 2nd blocked with 429 (1 req / 60s)', async () => {
      const phone = getNextPhone();
      const sendOtpDto = { phoneNumber: phone };

      // Request 1: allowed
      const res1 = await authController.sendOtp(sendOtpDto, getNextIp());
      expect(res1).toBeDefined();
      expect(authService.sendOtp).toHaveBeenCalledTimes(1);

      // Request 2 (cùng phone, khác IP): blocked 429
      try {
        await authController.sendOtp(sendOtpDto, getNextIp());
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      expect(authService.sendOtp).toHaveBeenCalledTimes(1);
    });

    it('IP limit: 1..5 requests allowed, 6th blocked with 429 (5 req / 600s)', async () => {
      const ip = getNextIp();

      // Requests 1..5: các số điện thoại khác nhau nhưng chung IP
      for (let i = 1; i <= RATE_LIMIT_CONFIG.OTP_SEND.IP_LIMIT; i++) {
        const res = await authController.sendOtp({ phoneNumber: getNextPhone() }, ip);
        expect(res).toBeDefined();
      }
      expect(authService.sendOtp).toHaveBeenCalledTimes(5);

      // Request 6: blocked 429 do vượt IP limit
      try {
        await authController.sendOtp({ phoneNumber: getNextPhone() }, ip);
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      expect(authService.sendOtp).toHaveBeenCalledTimes(5);
    });
  });

  describe('5. Verify OTP Rate Limiting', () => {
    it('Phone limit: 1..5 requests allowed, 6th blocked with 429 (5 req / 300s)', async () => {
      const phone = getNextPhone();
      const verifyOtpDto = { phoneNumber: phone, otp: '123456' };

      for (let i = 1; i <= RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_LIMIT; i++) {
        const res = await authController.verifyOtp(verifyOtpDto);
        expect(res).toBeDefined();
      }
      expect(authService.verifyOtp).toHaveBeenCalledTimes(5);

      try {
        await authController.verifyOtp(verifyOtpDto);
        expect.unreachable('Should have thrown 429 TooManyRequests');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = error.getResponse();
        expect(response.statusCode).toBe(429);
        expect(response.retryAfterSeconds).toBeGreaterThan(0);
      }

      expect(authService.verifyOtp).toHaveBeenCalledTimes(5);
    });
  });

  describe('6. Downstream Protection Verification', () => {
    it('Blocked request must NEVER invoke AuthService', async () => {
      const ip = getNextIp();
      const phone = getNextPhone();

      // Trigger rate limit exhaustion
      for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN.IP_LIMIT; i++) {
        await authController.login({ phoneNumber: getNextPhone(), password: 'Pwd' }, ip);
      }

      authService.login.mockClear();

      // Blocked call
      await expect(
        authController.login({ phoneNumber: phone, password: 'Pwd' }, ip),
      ).rejects.toThrow(HttpException);

      // Verify downstream AuthService was NEVER called
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('7. Redis Failure Handling (Fail-Closed)', () => {
    it('Redis error must NOT fail-open; error propagates and downstream logic is NOT called', async () => {
      const brokenRateLimitService = {
        checkLimit: vi.fn().mockRejectedValue(new Error('Redis connection lost!')),
      } as unknown as RateLimitService;

      const failingController = new AuthController(
        authService,
        usersService,
        brokenRateLimitService,
      );

      // Attempt login
      await expect(
        failingController.login(
          { phoneNumber: '0912345678', password: 'Password123!' },
          '127.0.0.1',
        ),
      ).rejects.toThrow('Redis connection lost!');

      // Crucial: AuthService must NOT be invoked when Redis fails
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('8. Input Normalization', () => {
    it('normalizeIp strips IPv6 prefix and handles null/empty', () => {
      expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('::1')).toBe('127.0.0.1');
      expect(normalizeIp(undefined)).toBe('127.0.0.1');
      expect(normalizeIp('  10.0.0.1  ')).toBe('10.0.0.1');
    });

    it('normalizePhone strips whitespace and handles null/empty', () => {
      expect(normalizePhone('  0981  234   567  ')).toBe('0981234567');
      expect(normalizePhone('+84 981 234 567')).toBe('+84981234567');
      expect(normalizePhone(undefined)).toBe('');
    });

    it('IPv6 mapped IPv4 and plain IPv4 share the same rate limit bucket', async () => {
      const ipv4 = getNextIp();
      const ipv6 = `::ffff:${ipv4}`;
      const phone = getNextPhone();

      // Exhaust limit using IPv6 mapped address
      for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN.IP_LIMIT; i++) {
        await authController.login(
          { phoneNumber: getNextPhone(), password: 'Password123!' },
          ipv6,
        );
      }

      // Next request from plain IPv4 should immediately be blocked 429
      await expect(
        authController.login({ phoneNumber: phone, password: 'Password123!' }, ipv4),
      ).rejects.toThrow(HttpException);
    });

    it('Phone numbers with whitespace share the same rate limit bucket', async () => {
      const phone = getNextPhone();
      const phoneWithSpaces = `  ${phone.slice(0, 4)}   ${phone.slice(4)}  `;

      // 5 requests with whitespace
      for (let i = 0; i < RATE_LIMIT_CONFIG.LOGIN.PHONE_LIMIT; i++) {
        await authController.login(
          { phoneNumber: phoneWithSpaces, password: 'Password123!' },
          getNextIp(),
        );
      }

      // Request without spaces should now be blocked 429
      await expect(
        authController.login(
          { phoneNumber: phone, password: 'Password123!' },
          getNextIp(),
        ),
      ).rejects.toThrow(HttpException);
    });
  });
});
