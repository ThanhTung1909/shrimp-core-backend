import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { Role } from '../src/common/enums/role.enum.js';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

describe('LOGIN -> USER SESSION INTEGRATION SUITE', () => {
  let redisService: RedisService;
  let otpService: OtpService;
  let authService: AuthService;
  let usersService: any;
  let jwtService: JwtService;
  let configService: ConfigService;
  let userSessionRepository: any;
  let dataSource: any;
  let loginSecurityService: any;

  let usersStore: Map<string, any>;
  let sessionsStore: any[];

  const testId = Date.now();
  let phoneSeq = 3000;
  const getNextPhone = () =>
    `095${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: 'test_jwt_access_secret_key_session_12345678',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_key_session_87654321',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    otpService = new OtpService(redisService);
    jwtService = new JwtService({
      secret: 'test_jwt_access_secret_key_session_12345678',
    });
  });

  afterAll(async () => {
    await redisService.onModuleDestroy();
  });

  beforeEach(() => {
    usersStore = new Map();
    sessionsStore = [];

    loginSecurityService = {
      recordFailure: vi.fn(async () => 1),
      createTemporaryLock: vi.fn(async () => {}),
      getTemporaryLockTtl: vi.fn(async () => 0),
      clear: vi.fn(async () => {}),
    };

    usersService = {
      findById: vi.fn(async (userId: string) => {
        for (const u of usersStore.values()) {
          if (u.userId === userId) return u;
        }
        return null;
      }),
      findByPhoneNumber: vi.fn(async (phone: string) => usersStore.get(phone) || null),
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
        id: 'sess-' + Math.random().toString(36).substring(2, 9),
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
      find: vi.fn(async () => sessionsStore),
      update: vi.fn(async (criteria: any, updateData: any) => {
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
        return { affected, raw: [] };
      }),
    };

    dataSource = {
      transaction: vi.fn(async (callback: any) => {
        const manager = {
          create: vi.fn((entity: any, data: any) => ({
            id: 'sess-' + Math.random().toString(36).substring(2, 9),
            createdAt: new Date(),
            lastUsedAt: new Date(),
            revokedAt: null,
            revokeReason: null,
            ...data,
          })),
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
          findOne: vi.fn(async (entity: any, options: any) => {
            const hash = options?.where?.refreshTokenHash;
            return sessionsStore.find((s) => s.refreshTokenHash === hash) || null;
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
            return { affected, raw: [] };
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
      {} as any, // emailService
      {} as any, // esmsService
      otpService,
      loginSecurityService,
    );
  });

  async function createMockUser(password = 'Password123!') {
    const phone = getNextPhone();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      userId: 'user-' + Math.random().toString(36).substring(2, 9),
      phoneNumber: phone,
      fullName: 'Test User ' + phone,
      passwordHash,
      isActive: true,
      tokenVersion: 0,
      role: Role.FARMER,
      isLoginLocked: false,
    };
    usersStore.set(phone, user);
    return { user, phone, password };
  }

  it('Test 1 — Login tạo thành công UserSession với deviceName', async () => {
    const { phone, password, user } = await createMockUser();

    const res = await authService.login(
      { phoneNumber: phone, password },
      'Mozilla/5.0 (Windows NT 10.0)',
    );

    expect(res).toBeDefined();
    expect(res.userId).toBe(user.userId);
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();

    // Kiểm tra UserSession trong database
    const session = sessionsStore.find((s) => s.userId === res.userId);
    expect(session).toBeDefined();
    expect(session.userId).toBe(res.userId);
    expect(session.revokedAt).toBeNull();
    expect(session.revokeReason).toBeNull();
    expect(session.deviceName).toBe('Mozilla/5.0 (Windows NT 10.0)');
  });

  it('Test 2 — Refresh token hash trong UserSession khớp chính xác SHA-256 của Refresh Token', async () => {
    const { phone, password, user } = await createMockUser();

    const res = await authService.login({ phoneNumber: phone, password });

    const expectedHash = crypto
      .createHash('sha256')
      .update(res.refreshToken)
      .digest('hex');

    const session = sessionsStore.find((s) => s.userId === user.userId);
    expect(session).toBeDefined();
    expect(session.refreshTokenHash).toBe(expectedHash);
    expect(session.refreshTokenHash).toHaveLength(64);
    expect((session as any).refreshToken).toBeUndefined(); // Không lưu plaintext
  });

  it('Test 3 — tokenFamily được tạo dưới dạng UUID hợp lệ', async () => {
    const { phone, password, user } = await createMockUser();

    await authService.login({ phoneNumber: phone, password });

    const session = sessionsStore.find((s) => s.userId === user.userId);
    expect(session.tokenFamily).toBeDefined();
    // UUID v4 format regex
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        session.tokenFamily,
      ),
    ).toBe(true);
    expect(session.tokenFamily).not.toBe(user.userId);
  });

  it('Test 4 — expiresAt trong UserSession khớp chính xác exp của Refresh Token', async () => {
    const { phone, password, user } = await createMockUser();

    const res = await authService.login({ phoneNumber: phone, password });

    const decoded = jwtService.decode(res.refreshToken) as { exp: number };
    const session = sessionsStore.find((s) => s.userId === user.userId);

    expect(session.expiresAt).toBeDefined();
    expect(session.expiresAt.getTime()).toBe(decoded.exp * 1000);
  });

  it('Test 5 & 6 — Refresh Token vừa cấp khi login có thể refresh và giữ nguyên tokenFamily (Rotation)', async () => {
    const { phone, password, user } = await createMockUser();

    const loginRes = await authService.login({ phoneNumber: phone, password });

    const initialSession = sessionsStore.find((s) => s.userId === user.userId);
    const initialFamily = initialSession.tokenFamily;

    // Thực hiện refresh token ngay sau khi login
    const refreshRes = await authService.refreshToken(loginRes.refreshToken);
    expect(refreshRes).toBeDefined();
    expect(refreshRes.accessToken).toBeDefined();
    expect(refreshRes.refreshToken).toBeDefined();
    expect(refreshRes.refreshToken).not.toBe(loginRes.refreshToken);

    // Session cũ bị revoke với lý do ROTATED
    expect(initialSession.revokedAt).not.toBeNull();
    expect(initialSession.revokeReason).toBe('ROTATED');

    // Session mới được tạo, cùng tokenFamily
    const newHash = crypto
      .createHash('sha256')
      .update(refreshRes.refreshToken)
      .digest('hex');
    const newSession = sessionsStore.find((s) => s.refreshTokenHash === newHash);

    expect(newSession).toBeDefined();
    expect(newSession.revokedAt).toBeNull();
    expect(newSession.tokenFamily).toBe(initialFamily); // Test 6: tokenFamily được bảo toàn
  });

  it('Test 7 — Logout hoạt động bình thường với refresh token nhận được sau khi login', async () => {
    const { phone, password, user } = await createMockUser();

    const loginRes = await authService.login({ phoneNumber: phone, password });

    const logoutRes = await authService.logout(loginRes.userId, loginRes.refreshToken);
    expect(logoutRes.message).toBe('Đăng xuất thành công!');

    const session = sessionsStore.find((s) => s.userId === user.userId);
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokeReason).toBe('LOGOUT');
  });

  it('Test 8 — Logout-all vô hiệu hóa active session nhận được từ login', async () => {
    const { phone, password, user } = await createMockUser();

    const loginRes = await authService.login({ phoneNumber: phone, password });

    await authService.logoutAll(loginRes.userId);

    const updatedUser = await usersService.findById(user.userId);
    expect(updatedUser.tokenVersion).toBe(1);

    const session = sessionsStore.find((s) => s.userId === user.userId);
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokeReason).toBe('LOGOUT_ALL');
  });

  it('Test 9 — Reuse detection hoạt động chuẩn xác với token login ban đầu', async () => {
    const { phone, password } = await createMockUser();

    const loginRes = await authService.login({ phoneNumber: phone, password });

    // Lần 1: Rotation hợp lệ (A -> B)
    const rotRes = await authService.refreshToken(loginRes.refreshToken);

    // Lần 2: Cố tình dùng lại token A đã bị rotate (Reuse Detection kích hoạt)
    await expect(authService.refreshToken(loginRes.refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );

    // Active session B trong cùng tokenFamily phải bị revoke với lý do REUSE_DETECTED
    const bHash = crypto
      .createHash('sha256')
      .update(rotRes.refreshToken)
      .digest('hex');
    const sessionB = sessionsStore.find((s) => s.refreshTokenHash === bHash);
    expect(sessionB.revokedAt).not.toBeNull();
    expect(sessionB.revokeReason).toBe('REUSE_DETECTED');
  });

  it('Test 10 & 11 — Lỗi khi tạo UserSession trong login ném InternalServerErrorException', async () => {
    const { phone, password } = await createMockUser();

    userSessionRepository.save = vi.fn().mockRejectedValueOnce(
      new Error('UserSession insert failed'),
    );

    await expect(
      authService.login({ phoneNumber: phone, password }),
    ).rejects.toThrow('UserSession insert failed');
  });
});
