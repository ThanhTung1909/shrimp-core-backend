import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import {
  OTP_CONFIG,
  getOtpCodeKey,
  getOtpAttemptsKey,
  getOtpVerifiedKey,
} from '../src/common/redis/otp.constants.js';
import { Role } from '../src/common/enums/role.enum.js';
import { JwtService } from '@nestjs/jwt';

describe('REDIS SECURITY HARDENING SUITE (PHASE 8 - STEP 8)', () => {
  let redisService: RedisService;
  let rateLimitService: RateLimitService;
  let otpService: OtpService;
  let authService: AuthService;
  let usersService: any;
  let jwtService: JwtService;
  let configService: ConfigService;
  let userSessionRepository: any;
  let dataSource: any;

  let usersStore: Map<string, any>;
  let sessionsStore: any[];

  const testId = Date.now();
  let phoneSeq = 1000;
  const getNextPhone = () => `094${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: 'test_jwt_access_secret_step8_hardening_12345',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_step8_hardening_54321',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    rateLimitService = new RateLimitService(redisService);
    otpService = new OtpService(redisService);
    jwtService = new JwtService({ secret: 'test_jwt_access_secret_step8_hardening_12345' });

    const originalSignAsync = jwtService.signAsync.bind(jwtService);
    let signCounter = 0;
    vi.spyOn(jwtService, 'signAsync').mockImplementation(async (payload: any, options?: any) => {
      signCounter++;
      return originalSignAsync(payload, {
        ...options,
        jwtid: 'tok-step8-' + signCounter + '-' + Math.random(),
      });
    });
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const otpKeys = await client.keys('otp:*:094*');
      const rlKeys = await client.keys('rl:*:094*');
      const hardenKeys = await client.keys('test:harden:*');
      const allKeys = [...otpKeys, ...rlKeys, ...hardenKeys];
      if (allKeys.length > 0) {
        await redisService.del(...allKeys);
      }
    }
    await redisService.onModuleDestroy();
  });

  beforeEach(() => {
    usersStore = new Map();
    sessionsStore = [];

    usersService = {
      findById: vi.fn(async (userId: string) => {
        for (const u of usersStore.values()) {
          if (u.userId === userId) return u;
        }
        return null;
      }),
      findByPhoneNumber: vi.fn(async (phone: string) => usersStore.get(phone) || null),
      createUser: vi.fn(async (data: any) => {
        const user = {
          userId: 'user-harden-' + Math.random(),
          tokenVersion: 0,
          isActive: true,
          role: data.role || Role.FARMER,
          ...data,
        };
        usersStore.set(data.phoneNumber, user);
        return user;
      }),
      incrementTokenVersion: vi.fn(async (userId: string) => {
        for (const u of usersStore.values()) {
          if (u.userId === userId) {
            u.tokenVersion = (u.tokenVersion || 0) + 1;
            return;
          }
        }
      }),
    };

    userSessionRepository = {
      create: vi.fn((data: any) => ({
        id: 'sess-harden-' + Math.random(),
        createdAt: new Date(),
        lastUsedAt: new Date(),
        revokedAt: null,
        revokeReason: null,
        ...data,
      })),
      save: vi.fn(async (session: any) => {
        const index = sessionsStore.findIndex((s) => s.id === session.id);
        if (index >= 0) {
          sessionsStore[index] = { ...sessionsStore[index], ...session };
          return sessionsStore[index];
        }
        sessionsStore.push(session);
        return session;
      }),
      findOne: vi.fn(async (options: any) => {
        const hash = options?.where?.refreshTokenHash;
        return sessionsStore.find((s) => s.refreshTokenHash === hash) || null;
      }),
    };

    dataSource = {
      transaction: vi.fn(async (callback: any) => {
        const manager = {
          create: vi.fn((entity: any, data: any) => ({
            id: 'sess-harden-' + Math.random(),
            createdAt: new Date(),
            lastUsedAt: new Date(),
            revokedAt: null,
            revokeReason: null,
            ...data,
          })),
          save: vi.fn(async (entity: any, session: any) => {
            const index = sessionsStore.findIndex((s) => s.id === session.id);
            if (index >= 0) {
              sessionsStore[index] = { ...sessionsStore[index], ...session };
              return sessionsStore[index];
            }
            sessionsStore.push(session);
            return session;
          }),
        };
        return await callback(manager);
      }),
    };

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      userSessionRepository,
      dataSource,
      otpService,
    );
  });

  // Requirement 1: Redis Connection
  it('Requirement 1: Redis connection is established and healthy', async () => {
    const client = redisService.getClient();
    expect(client).toBeDefined();
    expect(client.status).toBe('ready');

    const testKey = 'test:harden:ping';
    await redisService.set(testKey, 'pong', 10);
    const val = await redisService.get(testKey);
    expect(val).toBe('pong');
  });

  // Requirement 2: Rate Limit Atomicity
  it('Requirement 2: Rate limit Lua script executes atomically under concurrent load', async () => {
    const key = `test:harden:rl:atomic:${Date.now()}`;
    const limit = 5;
    const window = 60;

    // Send 10 concurrent requests
    const results = await Promise.all(
      Array.from({ length: 10 }).map(() => rateLimitService.checkLimit(key, limit, window)),
    );

    const allowed = results.filter((r) => r.allowed);
    const blocked = results.filter((r) => !r.allowed);

    expect(allowed).toHaveLength(5);
    expect(blocked).toHaveLength(5);
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // Requirement 3: Rate Limit TTL
  it('Requirement 3: Rate limit keys strictly enforce TTL and expire', async () => {
    const key = `test:harden:rl:ttl:${Date.now()}`;
    await rateLimitService.checkLimit(key, 10, 30);

    const ttl = await redisService.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  // Requirement 4: OTP TTL
  it('Requirement 4: OTP code key strictly enforces 300s TTL', async () => {
    const phone = getNextPhone();
    await otpService.createAndSaveOtp(phone);

    const codeKey = getOtpCodeKey(phone);
    const ttl = await redisService.ttl(codeKey);
    expect(ttl).toBeGreaterThan(250);
    expect(ttl).toBeLessThanOrEqual(OTP_CONFIG.TTL_SECONDS);
  });

  // Requirement 5: OTP Hash
  it('Requirement 5: Redis stores SHA-256 hash of OTP, never plaintext', async () => {
    const phone = getNextPhone();
    const { otp, otpHash } = await otpService.createAndSaveOtp(phone);

    const rawStored = await redisService.get(getOtpCodeKey(phone));
    expect(rawStored).not.toBeNull();
    expect(rawStored).not.toBe(otp);
    expect(rawStored).toBe(otpHash);
    expect(rawStored).toHaveLength(64);
  });

  // Requirement 6: OTP Max Attempts
  it('Requirement 6: OTP invalidates and deletes after 5 wrong attempts; 6th attempt fails', async () => {
    const phone = getNextPhone();
    const { otp } = await otpService.createAndSaveOtp(phone);

    for (let i = 1; i <= 5; i++) {
      await expect(otpService.verifyOtp(phone, '000000')).rejects.toThrow(BadRequestException);
    }

    // Both code and attempts keys must be deleted
    expect(await redisService.exists(getOtpCodeKey(phone))).toBe(0);
    expect(await redisService.exists(getOtpAttemptsKey(phone))).toBe(0);

    // 6th attempt with CORRECT OTP must still fail
    await expect(otpService.verifyOtp(phone, otp)).rejects.toThrow(BadRequestException);
  });

  // Requirement 7: OTP One-Time Use
  it('Requirement 7: OTP is strictly one-time use (second verification fails)', async () => {
    const phone = getNextPhone();
    const { otp } = await otpService.createAndSaveOtp(phone);

    // First verify succeeds
    await expect(otpService.verifyOtp(phone, otp)).resolves.toBe(true);

    // Second verify with same OTP must fail
    await expect(otpService.verifyOtp(phone, otp)).rejects.toThrow(BadRequestException);
  });

  // Requirement 8: Concurrent OTP Verify
  it('Requirement 8: Concurrent OTP verify requests allow exactly 1 success', async () => {
    const phone = getNextPhone();
    const { otp } = await otpService.createAndSaveOtp(phone);

    const results = await Promise.allSettled([
      otpService.verifyOtp(phone, otp),
      otpService.verifyOtp(phone, otp),
      otpService.verifyOtp(phone, otp),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(2);
  });

  // Requirement 9: OTP Verified Marker TTL
  it('Requirement 9: OTP verified marker has TTL of 600s', async () => {
    const phone = getNextPhone();
    const { otp } = await otpService.createAndSaveOtp(phone);

    await otpService.verifyOtp(phone, otp);

    const markerKey = getOtpVerifiedKey(phone);
    const ttl = await redisService.ttl(markerKey);
    expect(ttl).toBeGreaterThan(550);
    expect(ttl).toBeLessThanOrEqual(OTP_CONFIG.VERIFIED_TTL_SECONDS);
  });

  // Requirement 10: Atomic Consume Marker
  it('Requirement 10: Verified marker is atomically consumed and cannot be reused', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const firstConsume = await otpService.consumePhoneVerified(phone);
    expect(firstConsume).toBe(true);

    // Second consume must return false
    const secondConsume = await otpService.consumePhoneVerified(phone);
    expect(secondConsume).toBe(false);
  });

  // Requirement 11: Concurrent Register
  it('Requirement 11: Concurrent register calls with same OTP marker allow exactly 1 account creation', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const registerPayload = {
      fullName: 'Concurrent Hardening',
      phoneNumber: phone,
      password: 'Password123!',
    };

    const results = await Promise.allSettled([
      authService.register(registerPayload),
      authService.register(registerPayload),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(usersStore.has(phone)).toBe(true);
  });

  // Requirement 12: OTP Restore After Transaction Failure
  it('Requirement 12: OTP marker is restored if DB transaction fails, but NOT restored on success', async () => {
    const phoneFail = getNextPhone();
    await otpService.setPhoneVerified(phoneFail);

    // Mock failing transaction
    dataSource.transaction = vi.fn(async (cb: any) => {
      const failingManager = {
        create: vi.fn(),
        save: vi.fn().mockRejectedValue(new Error('DB Constraint Violation')),
      };
      return await cb(failingManager);
    });

    await expect(
      authService.register({
        fullName: 'Fail Transaction User',
        phoneNumber: phoneFail,
        password: 'Password123!',
      }),
    ).rejects.toThrow('DB Constraint Violation');

    // Marker MUST be restored
    expect(await otpService.isPhoneVerified(phoneFail)).toBe(true);

    // Restore normal transaction for success case
    dataSource.transaction = vi.fn(async (cb: any) => {
      const normalManager = {
        create: vi.fn((e: any, d: any) => ({ id: 'sess-' + Math.random(), ...d })),
        save: vi.fn(async (e: any, s: any) => s),
      };
      return await cb(normalManager);
    });

    const phoneSuccess = getNextPhone();
    await otpService.setPhoneVerified(phoneSuccess);

    await authService.register({
      fullName: 'Success User',
      phoneNumber: phoneSuccess,
      password: 'Password123!',
    });

    // Marker MUST NOT be restored on successful register
    expect(await otpService.isPhoneVerified(phoneSuccess)).toBe(false);
  });

  // Requirement 13: Redis Failure = Fail-Closed
  it('Requirement 13: Redis failure blocks operations (Fail-Closed, no security bypass)', async () => {
    const brokenRedisService = {
      getClient: () => ({
        eval: vi.fn().mockRejectedValue(new Error('Redis Unavailable')),
        pipeline: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnThis(),
          exec: vi.fn().mockRejectedValue(new Error('Redis Unavailable')),
        }),
      }),
      exists: vi.fn().mockRejectedValue(new Error('Redis Unavailable')),
    } as unknown as RedisService;

    const brokenRateLimit = new RateLimitService(brokenRedisService);
    const brokenOtp = new OtpService(brokenRedisService);

    // 1. RateLimitService throws and does NOT allow request
    await expect(brokenRateLimit.checkLimit('test:broken', 5, 60)).rejects.toThrow('Redis Unavailable');

    // 2. AuthController applying broken rate limit throws 500 / Error, blocking execution
    const brokenController = new AuthController(authService, usersService, brokenRateLimit);
    await expect(
      brokenController.register(
        { fullName: 'Broken', phoneNumber: getNextPhone(), password: 'Pass' },
        '10.0.0.1',
      ),
    ).rejects.toThrow('Redis Unavailable');

    // 3. OtpService throws and does NOT fail-open
    await expect(brokenOtp.verifyOtp('0940000000', '123456')).rejects.toThrow('Redis Unavailable');
    await expect(brokenOtp.createAndSaveOtp('0940000000')).rejects.toThrow('Redis Unavailable');
  });

  // Requirement 14: Register Requires OTP
  it('Requirement 14: Register requires OTP verification and rejects unverified requests', async () => {
    const phone = getNextPhone();
    const registerDto = {
      fullName: 'Unverified Register User',
      phoneNumber: phone,
      password: 'Password123!',
    };

    await expect(authService.register(registerDto)).rejects.toThrow(BadRequestException);
    await expect(authService.register(registerDto)).rejects.toThrow('Vui lòng xác thực OTP trước khi đăng ký!');
    expect(usersStore.has(phone)).toBe(false);
  });

  // Security Invariants Check: No Plaintext Secrets in Storage or Response
  it('Security Invariant: Refresh tokens in user_sessions are SHA-256 hashes, not plaintext', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const reg = await authService.register({
      fullName: 'Hash Invariant User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    const session = sessionsStore.find((s) => s.userId === reg.userId);
    expect(session).toBeDefined();
    expect(session.refreshTokenHash).toHaveLength(64);
    expect(session.refreshTokenHash).not.toBe(reg.refreshToken);
    expect(session.refreshToken).toBeUndefined();
  });
});
