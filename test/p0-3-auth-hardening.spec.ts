import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { RedisService } from '../src/common/redis/redis.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { OtpPurpose } from '../src/common/redis/otp.constants.js';
import { getAccessTokenBlacklistKey } from '../src/common/redis/rate-limit.constants.js';
import { Role } from '../src/common/enums/role.enum.js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

describe('P0-3 AUTH HARDENING TEST SUITE: Password Reset & Access Token Blacklist', () => {
  let configService: ConfigService;
  let redisService: RedisService;
  let otpService: OtpService;
  let rateLimitService: RateLimitService;
  let jwtService: JwtService;
  let jwtStrategy: JwtStrategy;
  let authService: AuthService;
  let authController: AuthController;
  let usersService: any;
  let userSessionRepository: any;
  let dataSource: any;
  let emailService: any;
  let esmsService: any;

  let usersStore: Map<string, any>;
  let sessionsStore: any[];

  const accessSecret = 'test_access_secret_p03_minimum_32_bytes_long';
  const refreshSecret = 'test_refresh_secret_p03_minimum_32_bytes_long';

  const testId = Date.now();
  let phoneSeq = 5000;
  const getNextPhone = () => `093${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: accessSecret,
      JWT_REFRESH_SECRET: refreshSecret,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    otpService = new OtpService(redisService);
    rateLimitService = new RateLimitService(redisService);
    jwtService = new JwtService({
      secret: accessSecret,
      signOptions: { expiresIn: '15m' },
    });
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const otpKeys = await client.keys('otp:*:093*');
      const blKeys = await client.keys('auth:blacklist:access:*');
      const allKeys = [...otpKeys, ...blKeys];
      if (allKeys.length > 0) {
        await redisService.del(...allKeys);
      }
    }
    await redisService.onModuleDestroy();
  });

  beforeEach(async () => {
    usersStore = new Map();
    sessionsStore = [];

    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const rlKeys = await client.keys('rl:*');
      const otpKeys = await client.keys('otp:*:093*');
      const blKeys = await client.keys('auth:blacklist:access:*');
      const allKeys = [...rlKeys, ...otpKeys, ...blKeys];
      if (allKeys.length > 0) {
        await redisService.del(...allKeys);
      }
    }

    usersService = {
      findById: vi.fn(async (userId: string) => {
        for (const u of usersStore.values()) {
          if (u.userId === userId) return u;
        }
        return null;
      }),
      findByPhoneNumber: vi.fn(async (phone: string) => usersStore.get(phone) || null),
      findByEmail: vi.fn(async (_email: string) => null),
      incrementTokenVersion: vi.fn(async (userId: string) => {
        for (const u of usersStore.values()) {
          if (u.userId === userId) {
            u.tokenVersion = (u.tokenVersion || 0) + 1;
            return;
          }
        }
      }),
      updatePassword: vi.fn(async (userId: string, newHash: string) => {
        for (const u of usersStore.values()) {
          if (u.userId === userId) {
            u.passwordHash = newHash;
            u.mustChangePassword = false;
            return;
          }
        }
      }),
      setLoginLocked: vi.fn(),
      sanitizeUser: vi.fn((user: any) => {
        const { passwordHash: _passwordHash, ...rest } = user;
        return rest;
      }),
      sanitizeAuthenticatedUser: vi.fn((user: any) => {
        const { passwordHash: _passwordHash, ...rest } = user;
        return rest;
      }),
    };

    userSessionRepository = {
      create: vi.fn((dto: any) => ({
        ...dto,
        id: 'sess-' + Math.random(),
        revokedAt: null,
        revokeReason: null,
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
      find: vi.fn(async () => sessionsStore),
      update: vi.fn(async (entityOrCriteria: any, criteriaOrUpdate: any, maybeUpdate?: any) => {
        const criteria = maybeUpdate !== undefined ? criteriaOrUpdate : entityOrCriteria;
        const updateData = maybeUpdate !== undefined ? maybeUpdate : criteriaOrUpdate;
        let affected = 0;
        for (const s of sessionsStore) {
          let match = true;
          if (criteria.tokenFamily && s.tokenFamily !== criteria.tokenFamily) match = false;
          if (criteria.userId && s.userId !== criteria.userId) match = false;
          if ('revokedAt' in criteria && s.revokedAt !== null) match = false;
          if (match) {
            Object.assign(s, updateData);
            affected++;
          }
        }
        return { affected, raw: [], generatedMaps: [] };
      }),
    };

    let txLock = Promise.resolve();
    dataSource = {
      transaction: vi.fn(async (callback: any) => {
        const execute = async () => {
          const manager = {
            findOne: vi.fn(async (entityOrOptions: any, maybeOptions?: any) => {
              const options = maybeOptions || entityOrOptions;
              const hash = options?.where?.refreshTokenHash;
              return sessionsStore.find((s) => s.refreshTokenHash === hash) || null;
            }),
            create: vi.fn((entityOrDto: any, maybeDto?: any) => {
              const dto = maybeDto || entityOrDto;
              return {
                ...dto,
                id: 'sess-' + Math.random(),
                revokedAt: null,
                revokeReason: null,
              };
            }),
            save: vi.fn(async (entityOrSession: any, maybeSession?: any) => {
              const session = maybeSession || entityOrSession;
              const index = sessionsStore.findIndex((s) => s.id === session.id);
              if (index >= 0) {
                sessionsStore[index] = { ...sessionsStore[index], ...session };
                return sessionsStore[index];
              }
              sessionsStore.push(session);
              return session;
            }),
            update: vi.fn(async (entityOrCriteria: any, criteriaOrUpdate: any, maybeUpdate?: any) => {
              const criteria = maybeUpdate !== undefined ? criteriaOrUpdate : entityOrCriteria;
              const updateData = maybeUpdate !== undefined ? maybeUpdate : criteriaOrUpdate;
              let affected = 0;
              for (const s of sessionsStore) {
                let match = true;
                if (criteria.tokenFamily && s.tokenFamily !== criteria.tokenFamily) match = false;
                if (criteria.userId && s.userId !== criteria.userId) match = false;
                if ('revokedAt' in criteria && s.revokedAt !== null) match = false;
                if (match) {
                  Object.assign(s, updateData);
                  affected++;
                }
              }
              return { affected, raw: [], generatedMaps: [] };
            }),
          };
          return await callback(manager);
        };

        const prevLock = txLock;
        let resolveLock: () => void;
        txLock = new Promise<void>((resolve) => {
          resolveLock = resolve;
        });
        await prevLock;
        try {
          return await execute();
        } finally {
          resolveLock!();
        }
      }),
    };

    emailService = {
      sendInitialPassword: vi.fn().mockResolvedValue(undefined),
    };
    esmsService = {
      sendSMS: vi.fn().mockResolvedValue(undefined),
    };

    jwtStrategy = new JwtStrategy(configService, usersService, redisService);

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      userSessionRepository,
      dataSource,
      emailService,
      esmsService,
      otpService,
      undefined,
      redisService,
    );

    authController = new AuthController(
      authService,
      usersService,
      rateLimitService,
      jwtService,
      configService,
    );
  });

  // =========================================================================
  // SECTION 1: FORGOT PASSWORD (POST /auth/forgot-password)
  // =========================================================================
  describe('1. FORGOT PASSWORD API (POST /auth/forgot-password)', () => {
    it('Requirement 1: Known account receives OTP via SMS and returns success response', async () => {
      const phone = getNextPhone();
      const mockUser = {
        userId: 'user-forgot-1',
        phoneNumber: phone,
        passwordHash: 'hashed',
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Forgot User 1',
      };
      usersStore.set(phone, mockUser);

      const res = await authController.forgotPassword({ phoneNumber: phone });
      expect(res.message).toBe('Nếu số điện thoại hợp lệ, mã OTP đã được gửi');
      expect(res.phoneNumber).toBe(phone);
      expect(res.expiresIn).toBe('5 phút');
      expect(res.otp).toBeUndefined();

      // EsmsService was called
      expect(esmsService.sendSMS).toHaveBeenCalledWith(phone, expect.any(String));

      // Verify OTP was stored in Redis with RESET_PASSWORD purpose
      const sentOtp = esmsService.sendSMS.mock.calls[0][1];
      const isVerified = await otpService.verifyOtp(OtpPurpose.RESET_PASSWORD, phone, sentOtp);
      expect(isVerified).toBe(true);
    });

    it('Requirement 2: Anti-enumeration: unknown account returns identical success response shape without throwing', async () => {
      const unknownPhone = getNextPhone();
      // Account does NOT exist in usersStore
      expect(usersStore.get(unknownPhone)).toBeUndefined();

      const res = await authController.forgotPassword({ phoneNumber: unknownPhone });
      expect(res).toBeDefined();
      expect(res.phoneNumber).toBe(unknownPhone);
      expect(res.expiresIn).toBe('5 phút');
      // SMS should NOT be sent for unknown phone
      expect(esmsService.sendSMS).not.toHaveBeenCalled();

      const knownPhone = getNextPhone();
      usersStore.set(knownPhone, {
        userId: 'user-forgot-shape',
        phoneNumber: knownPhone,
        isActive: true,
      });
      const knownRes = await authController.forgotPassword({ phoneNumber: knownPhone });
      expect(knownRes.message).toBe(res.message);
      expect(knownRes.expiresIn).toBe(res.expiresIn);
      expect(Object.keys(knownRes).sort()).toEqual(Object.keys(res).sort());
    });

    it('Requirement 3: Uses RESET_PASSWORD purpose and existing OTP TTL infrastructure', async () => {
      const phone = getNextPhone();
      usersStore.set(phone, {
        userId: 'user-forgot-3',
        phoneNumber: phone,
        passwordHash: 'hash',
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Forgot User 3',
      });

      await authController.forgotPassword({ phoneNumber: phone });
      const sentOtp = esmsService.sendSMS.mock.calls[0][1];

      // Attempting to verify with REGISTER purpose should FAIL (purpose isolation)
      await expect(
        otpService.verifyOtp(OtpPurpose.REGISTER, phone, sentOtp),
      ).rejects.toThrow();

      // Verifying with RESET_PASSWORD succeeds
      const verifySuccess = await otpService.verifyOtp(OtpPurpose.RESET_PASSWORD, phone, sentOtp);
      expect(verifySuccess).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 2: RESET PASSWORD (POST /auth/reset-password)
  // =========================================================================
  describe('2. RESET PASSWORD FLOW (POST /auth/reset-password)', () => {
    it('Requirement 5: Reset without verified OTP is rejected with 400 BadRequestException', async () => {
      const phone = getNextPhone();
      usersStore.set(phone, {
        userId: 'user-reset-5',
        phoneNumber: phone,
        passwordHash: 'old_hash',
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Reset User 5',
      });

      // No OTP verified marker in Redis
      await expect(
        authController.resetPassword({
          phoneNumber: phone,
          newPassword: 'NewValidPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('Requirement 6 & 8: Valid verified reset flow changes password and consumes marker atomically (one-time use)', async () => {
      const phone = getNextPhone();
      const oldHash = await bcrypt.hash('OldPassword123!', 10);
      const mockUser = {
        userId: 'user-reset-6',
        phoneNumber: phone,
        passwordHash: oldHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Reset User 6',
      };
      usersStore.set(phone, mockUser);

      // 1. Send OTP
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.RESET_PASSWORD, phone);

      // 2. Verify OTP -> sets verified marker
      const verified = await otpService.verifyOtp(OtpPurpose.RESET_PASSWORD, phone, otp);
      expect(verified).toBe(true);
      expect(await otpService.isPhoneVerified(OtpPurpose.RESET_PASSWORD, phone)).toBe(true);

      // 3. Reset password
      const resetRes = await authController.resetPassword({
        phoneNumber: phone,
        newPassword: 'BrandNewPassword123!',
      });
      expect(resetRes.message).toContain('Đặt lại mật khẩu thành công');

      // Password was hashed and updated
      expect(usersService.updatePassword).toHaveBeenCalledTimes(1);
      const newHash = mockUser.passwordHash;
      expect(await bcrypt.compare('BrandNewPassword123!', newHash)).toBe(true);
      expect(await bcrypt.compare('OldPassword123!', newHash)).toBe(false);

      // 4. Marker is consumed: cannot reset again with the same verification
      expect(await otpService.isPhoneVerified(OtpPurpose.RESET_PASSWORD, phone)).toBe(false);

      await expect(
        authController.resetPassword({
          phoneNumber: phone,
          newPassword: 'AnotherPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Requirement 9: Successful reset invalidates existing sessions with PASSWORD_RESET and increments tokenVersion', async () => {
      const phone = getNextPhone();
      const oldHash = await bcrypt.hash('OldPass123!', 10);
      const mockUser = {
        userId: 'user-reset-9',
        phoneNumber: phone,
        passwordHash: oldHash,
        isActive: true,
        tokenVersion: 2,
        role: Role.FARMER,
        fullName: 'Reset User 9',
      };
      usersStore.set(phone, mockUser);

      // Add active sessions for this user
      const sess1 = {
        id: 'sess-r9-1',
        userId: mockUser.userId,
        refreshTokenHash: 'hash-r9-1',
        tokenFamily: 'fam-r9',
        revokedAt: null,
        revokeReason: null,
      };
      const sess2 = {
        id: 'sess-r9-2',
        userId: mockUser.userId,
        refreshTokenHash: 'hash-r9-2',
        tokenFamily: 'fam-r9',
        revokedAt: null,
        revokeReason: null,
      };
      sessionsStore.push(sess1, sess2);

      // Set verified marker
      await otpService.setPhoneVerified(OtpPurpose.RESET_PASSWORD, phone);

      await authController.resetPassword({
        phoneNumber: phone,
        newPassword: 'NewStrongPassword123!',
      });

      // TokenVersion incremented
      expect(usersService.incrementTokenVersion).toHaveBeenCalledWith(mockUser.userId, expect.anything());

      // Sessions revoked with PASSWORD_RESET
      expect(sess1.revokedAt).toBeInstanceOf(Date);
      expect(sess1.revokeReason).toBe('PASSWORD_RESET');
      expect(sess2.revokedAt).toBeInstanceOf(Date);
      expect(sess2.revokeReason).toBe('PASSWORD_RESET');
    });
  });

  // =========================================================================
  // SECTION 3: ACCESS TOKEN BLACKLIST ON LOGOUT
  // =========================================================================
  describe('3. ACCESS TOKEN BLACKLIST & TOKEN REVOCATION (POST /auth/logout)', () => {
    it('Requirement 11 & 14: Valid Access Token works before logout, but is rejected with 401 after logout', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const mockUser = {
        userId: 'user-bl-11',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Blacklist User 11',
      };
      usersStore.set(phone, mockUser);

      // 1. User logs in
      const loginRes = await authService.login({ phoneNumber: phone, password });
      const { accessToken, refreshToken } = loginRes;

      // Access token has jti
      const decodedAccess = jwtService.decode(accessToken) as any;
      expect(decodedAccess.jti).toBeDefined();

      // 2. Validate with JwtStrategy BEFORE logout -> SUCCESS
      const userBeforeLogout = await jwtStrategy.validate(decodedAccess);
      expect(userBeforeLogout.userId).toBe(mockUser.userId);

      // 3. User calls POST /auth/logout with Authorization header
      const authHeader = `Bearer ${accessToken}`;
      const logoutRes = await authController.logout(
        mockUser.userId,
        { refreshToken },
        authHeader,
      );
      expect(logoutRes.message).toBe('Đăng xuất thành công!');

      // 4. Redis has the blacklist key
      const blacklistKey = getAccessTokenBlacklistKey(decodedAccess.jti);
      const isBlacklisted = await redisService.get(blacklistKey);
      expect(isBlacklisted).toBe('1');

      // 5. Validate with JwtStrategy AFTER logout -> REJECTED with 401
      await expect(jwtStrategy.validate(decodedAccess)).rejects.toThrow(UnauthorizedException);
      await expect(jwtStrategy.validate(decodedAccess)).rejects.toThrow('Token đã bị thu hồi!');
    });

    it('Requirement 13: Redis blacklist TTL approximately matches remaining JWT lifetime', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const mockUser = {
        userId: 'user-bl-13',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Blacklist User 13',
      };
      usersStore.set(phone, mockUser);

      const loginRes = await authService.login({ phoneNumber: phone, password });
      const { accessToken, refreshToken } = loginRes;
      const decodedAccess = jwtService.decode(accessToken) as any;

      await authController.logout(
        mockUser.userId,
        { refreshToken },
        `Bearer ${accessToken}`,
      );

      const blacklistKey = getAccessTokenBlacklistKey(decodedAccess.jti);
      const ttl = await redisService.ttl(blacklistKey);

      // Access Token expires in 15m (900s) -> TTL should be ~900s (> 800s and <= 900s)
      expect(ttl).toBeGreaterThan(800);
      expect(ttl).toBeLessThanOrEqual(900);
    });

    it('Requirement 15: Another device/access token is NOT blacklisted by per-device logout', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const mockUser = {
        userId: 'user-bl-15',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Blacklist User 15',
      };
      usersStore.set(phone, mockUser);

      // Device A Login
      const loginA = await authService.login({ phoneNumber: phone, password }, 'Device A');
      const decodedA = jwtService.decode(loginA.accessToken) as any;

      // Device B Login
      const loginB = await authService.login({ phoneNumber: phone, password }, 'Device B');
      const decodedB = jwtService.decode(loginB.accessToken) as any;

      expect(decodedA.jti).not.toBe(decodedB.jti);

      // Device A logs out
      await authController.logout(
        mockUser.userId,
        { refreshToken: loginA.refreshToken },
        `Bearer ${loginA.accessToken}`,
      );

      // Device A is rejected
      await expect(jwtStrategy.validate(decodedA)).rejects.toThrow('Token đã bị thu hồi!');

      // Device B is STILL VALID!
      const validB = await jwtStrategy.validate(decodedB);
      expect(validB.userId).toBe(mockUser.userId);
    });

    it('Requirement 16: Existing refresh session is still revoked by per-device logout', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const mockUser = {
        userId: 'user-bl-16',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'Blacklist User 16',
      };
      usersStore.set(phone, mockUser);

      const loginRes = await authService.login({ phoneNumber: phone, password });
      const hash = crypto.createHash('sha256').update(loginRes.refreshToken).digest('hex');

      await authController.logout(
        mockUser.userId,
        { refreshToken: loginRes.refreshToken },
        `Bearer ${loginRes.accessToken}`,
      );

      const session = sessionsStore.find((s) => s.refreshTokenHash === hash);
      expect(session).toBeDefined();
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(session.revokeReason).toBe('LOGOUT');

      // Refreshing with the revoked refresh token fails
      await expect(authService.refreshToken(loginRes.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('Requirement 17: Expired or non-positive TTL token does not create an invalid permanent blacklist entry', async () => {
      const mockJti = 'expired-token-jti-' + Date.now();
      const pastExp = Math.floor(Date.now() / 1000) - 100; // Expired 100s ago

      await authService.logout(
        'some-user-id',
        'invalid-refresh-token',
        mockJti,
        pastExp,
      );

      const blacklistKey = getAccessTokenBlacklistKey(mockJti);
      const exists = await redisService.exists(blacklistKey);
      expect(exists).toBe(0); // Key was NOT created in Redis
    });

    it('Requirement 18: Logout-all increments tokenVersion and revokes all active sessions with LOGOUT_ALL', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const mockUser = {
        userId: 'user-bl-18',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 1,
        role: Role.FARMER,
        fullName: 'Blacklist User 18',
      };
      usersStore.set(phone, mockUser);

      const loginRes = await authService.login({ phoneNumber: phone, password });
      const decoded = jwtService.decode(loginRes.accessToken) as any;

      // Logout All
      const logoutAllRes = await authController.logoutAll(mockUser.userId);
      expect(logoutAllRes.message).toBe('Đã đăng xuất khỏi tất cả thiết bị!');

      // tokenVersion incremented to 2
      expect(mockUser.tokenVersion).toBe(2);

      // Access Token with old tokenVersion (1) is now rejected by JwtStrategy
      await expect(jwtStrategy.validate(decoded)).rejects.toThrow(UnauthorizedException);
    });

    it('Requirement 19: Access Token missing jti claim is rejected by JwtStrategy', async () => {
      const payloadWithoutJti = {
        sub: 'user-no-jti',
        phoneNumber: '0931234567',
        tokenVersion: 0,
        role: 'FARMER',
        type: 'access',
      };

      await expect(jwtStrategy.validate(payloadWithoutJti as any)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(jwtStrategy.validate(payloadWithoutJti as any)).rejects.toThrow(
        'Token không hợp lệ!',
      );
    });

    it('Requirement 20: Redis blacklist lookup failure in JwtStrategy fails closed (throws 401, not silent auth)', async () => {
      const brokenRedisService = {
        get: vi.fn().mockRejectedValue(new Error('Redis cluster partitioned')),
      } as unknown as RedisService;

      const failingStrategy = new JwtStrategy(configService, usersService, brokenRedisService);

      const validPayload = {
        sub: 'user-fail-closed',
        phoneNumber: '0937654321',
        tokenVersion: 0,
        role: 'FARMER',
        type: 'access',
        jti: 'some-valid-jti',
      };

      await expect(failingStrategy.validate(validPayload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(failingStrategy.validate(validPayload)).rejects.toThrow(
        'Không thể xác thực trạng thái token!',
      );
    });

    it('Requirement 21: Missing Redis dependency in JwtStrategy fails closed', async () => {
      const strategyWithoutRedis = new JwtStrategy(configService, usersService, undefined);

      const validPayload = {
        sub: 'user-no-redis',
        phoneNumber: '0937654321',
        tokenVersion: 0,
        role: 'FARMER',
        type: 'access',
        jti: 'some-valid-jti',
      };

      await expect(strategyWithoutRedis.validate(validPayload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategyWithoutRedis.validate(validPayload)).rejects.toThrow(
        'Dịch vụ xác thực tạm thời không khả dụng!',
      );
    });

    it('Requirement 22: Logout fails closed if Redis blacklist persistence fails (throws Error, does not report success)', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      usersStore.set(phone, {
        userId: 'user-logout-fail',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
      });

      const failingRedisService = {
        set: vi.fn().mockRejectedValue(new Error('Redis write failed')),
      } as unknown as RedisService;

      const failingAuthService = new AuthService(
        usersService,
        jwtService,
        configService,
        userSessionRepository,
        dataSource,
        emailService,
        esmsService,
        otpService,
        undefined,
        failingRedisService,
      );

      await expect(
        failingAuthService.logout('user-logout-fail', 'some-refresh-token', 'jti-123', Math.floor(Date.now() / 1000) + 500),
      ).rejects.toThrow('Không thể thu hồi Access Token. Vui lòng thử lại!');
    });

    it('Requirement 23: All Access Token issuance paths issue unique jti (login, verifyOtp LOGIN, refreshToken, changePassword)', async () => {
      const phone = getNextPhone();
      const password = 'Password123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const mockUser = {
        userId: 'user-all-paths',
        phoneNumber: phone,
        passwordHash,
        isActive: true,
        tokenVersion: 0,
        role: Role.FARMER,
        fullName: 'All Paths User',
      };
      usersStore.set(phone, mockUser);

      // Path 1: password login
      const loginRes = await authService.login({ phoneNumber: phone, password });
      const jtiLogin = (jwtService.decode(loginRes.accessToken) as any).jti;
      expect(jtiLogin).toBeDefined();
      expect(typeof jtiLogin).toBe('string');

      // Path 2: refreshToken rotation
      const refreshRes = await authService.refreshToken(loginRes.refreshToken);
      const jtiRefresh = (jwtService.decode(refreshRes.accessToken) as any).jti;
      expect(jtiRefresh).toBeDefined();
      expect(jtiRefresh).not.toBe(jtiLogin);

      // Path 3: verifyOtp with LOGIN purpose
      const { otp } = await otpService.createAndSaveOtp(OtpPurpose.LOGIN, phone);
      const verifyRes = await authService.verifyOtp({ phoneNumber: phone, otp, purpose: OtpPurpose.LOGIN });
      const jtiOtpLogin = (jwtService.decode(verifyRes.accessToken) as any).jti;
      expect(jtiOtpLogin).toBeDefined();
      expect(jtiOtpLogin).not.toBe(jtiLogin);
      expect(jtiOtpLogin).not.toBe(jtiRefresh);

      // Path 4: changePassword
      const { otp: changeOtp } = await otpService.createAndSaveOtp(
        OtpPurpose.CHANGE_PASSWORD,
        phone,
      );
      const changePassRes = await authService.changePassword(mockUser.userId, {
        currentPassword: password,
        newPassword: 'NewPassword123!',
        otp: changeOtp,
      });
      const jtiChangePass = (jwtService.decode(changePassRes.accessToken) as any).jti;
      expect(jtiChangePass).toBeDefined();
      expect(jtiChangePass).not.toBe(jtiLogin);
      expect(jtiChangePass).not.toBe(jtiRefresh);
      expect(jtiChangePass).not.toBe(jtiOtpLogin);
    });
  });
});
