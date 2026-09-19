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

describe('REGISTER -> USER SESSION INTEGRATION SUITE (STEP 7)', () => {
  let redisService: RedisService;
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
  let phoneSeq = 3000;
  const getNextPhone = () => `095${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: 'test_jwt_access_secret_key_step7_12345678',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_key_step7_87654321',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    otpService = new OtpService(redisService);
    jwtService = new JwtService({ secret: 'test_jwt_access_secret_key_step7_12345678' });

    const originalSignAsync = jwtService.signAsync.bind(jwtService);
    let signCounter = 0;
    vi.spyOn(jwtService, 'signAsync').mockImplementation(async (payload: any, options?: any) => {
      signCounter++;
      return originalSignAsync(payload, {
        ...options,
        jwtid: 'tok-' + signCounter + '-' + Math.random(),
      });
    });
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const keys = await client.keys('otp:*:095*');
      if (keys.length > 0) {
        await redisService.del(...keys);
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
          userId: 'user-' + Math.random(),
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
        id: 'sess-' + Math.random(),
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
    };

    dataSource = {
      transaction: vi.fn(async (callback: any) => {
        const manager = {
          create: vi.fn((entity: any, data: any) => ({
            id: 'sess-' + Math.random(),
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
          findOne: vi.fn(async (entity: any, options: any) => {
            const hash = options?.where?.refreshTokenHash;
            return sessionsStore.find((s) => s.refreshTokenHash === hash) || null;
          }),
          update: vi.fn(async (entity: any, criteria: any, updateData: any) => {
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
      otpService,
    );
  });

  it('Test 1 — Register tạo thành công UserSession', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const res = await authService.register(
      {
        fullName: 'Session User',
        phoneNumber: phone,
        password: 'Password123!',
      },
      'Mozilla/5.0 (Windows NT 10.0)',
    );

    expect(res).toBeDefined();
    expect(res.userId).toBeDefined();

    // Kiểm tra UserSession trong database
    const session = sessionsStore.find((s) => s.userId === res.userId);
    expect(session).toBeDefined();
    expect(session.userId).toBe(res.userId);
    expect(session.revokedAt).toBeNull();
    expect(session.revokeReason).toBeNull();
    expect(session.deviceName).toBe('Mozilla/5.0 (Windows NT 10.0)');
  });

  it('Test 2 — Refresh token hash trong UserSession khớp chính xác SHA-256 của Refresh Token', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const res = await authService.register({
      fullName: 'Hash User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    const expectedHash = crypto
      .createHash('sha256')
      .update(res.refreshToken)
      .digest('hex');

    const session = sessionsStore.find((s) => s.userId === res.userId);
    expect(session).toBeDefined();
    expect(session.refreshTokenHash).toBe(expectedHash);
    expect(session.refreshTokenHash).toHaveLength(64);
    expect(session.refreshToken).toBeUndefined(); // Không lưu plaintext
  });

  it('Test 3 — tokenFamily được tạo dưới dạng UUID hợp lệ', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const res = await authService.register({
      fullName: 'UUID Family User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    const session = sessionsStore.find((s) => s.userId === res.userId);
    expect(session.tokenFamily).toBeDefined();
    // UUID v4 format regex
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        session.tokenFamily,
      ),
    ).toBe(true);
    expect(session.tokenFamily).not.toBe(res.userId);
  });

  it('Test 4 — expiresAt trong UserSession khớp chính xác exp của Refresh Token', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const res = await authService.register({
      fullName: 'Expires User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    const decoded = jwtService.decode(res.refreshToken) as { exp: number };
    const session = sessionsStore.find((s) => s.userId === res.userId);

    expect(session.expiresAt).toBeDefined();
    expect(session.expiresAt.getTime()).toBe(decoded.exp * 1000);
  });

  it('Test 5 & 6 — Refresh Token vừa cấp khi đăng ký có thể refresh và giữ nguyên tokenFamily (Rotation)', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const regRes = await authService.register({
      fullName: 'Rotation User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    const initialSession = sessionsStore.find((s) => s.userId === regRes.userId);
    const initialFamily = initialSession.tokenFamily;

    // Thực hiện refresh token ngay sau khi register
    const refreshRes = await authService.refreshToken(regRes.refreshToken);
    expect(refreshRes).toBeDefined();
    expect(refreshRes.accessToken).toBeDefined();
    expect(refreshRes.refreshToken).toBeDefined();
    expect(refreshRes.refreshToken).not.toBe(regRes.refreshToken);

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

  it('Test 7 — Logout hoạt động bình thường với refresh token nhận được sau khi đăng ký', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const regRes = await authService.register({
      fullName: 'Logout User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    const logoutRes = await authService.logout(regRes.userId, regRes.refreshToken);
    expect(logoutRes.message).toBe('Đăng xuất thành công!');

    const session = sessionsStore.find((s) => s.userId === regRes.userId);
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokeReason).toBe('LOGOUT');
  });

  it('Test 8 — Logout-all vô hiệu hóa active session nhận được từ register', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const regRes = await authService.register({
      fullName: 'Logout All User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    await authService.logoutAll(regRes.userId);

    const user = await usersService.findById(regRes.userId);
    expect(user.tokenVersion).toBe(1);

    const session = sessionsStore.find((s) => s.userId === regRes.userId);
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokeReason).toBe('LOGOUT_ALL');
  });

  it('Test 9 — Reuse detection hoạt động chuẩn xác với token đăng ký ban đầu', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const regRes = await authService.register({
      fullName: 'Reuse User',
      phoneNumber: phone,
      password: 'Password123!',
    });

    // Lần 1: Rotation hợp lệ (A -> B)
    const rotRes = await authService.refreshToken(regRes.refreshToken);

    // Lần 2: Cố tình dùng lại token A đã bị rotate (Reuse Detection kích hoạt)
    await expect(authService.refreshToken(regRes.refreshToken)).rejects.toThrow(
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

  it('Test 10 & 11 — Lỗi khi tạo UserSession thì transaction rollback và không trả token orphan', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    // Mock session save lỗi
    dataSource.transaction = vi.fn(async (callback: any) => {
      const failingManager = {
        create: vi.fn(),
        save: vi.fn().mockRejectedValue(new Error('UserSession insert failed')),
      };
      return await callback(failingManager);
    });

    await expect(
      authService.register({
        fullName: 'Fail User',
        phoneNumber: phone,
        password: 'Password123!',
      }),
    ).rejects.toThrow('UserSession insert failed');

    // Marker OTP phải được khôi phục cho user
    expect(await otpService.isPhoneVerified(phone)).toBe(true);
  });

  it('Test 12 — Concurrent register: chỉ 1 User và 1 UserSession được tạo', async () => {
    const phone = getNextPhone();
    await otpService.setPhoneVerified(phone);

    const results = await Promise.allSettled([
      authService.register({
        fullName: 'Concurrent 1',
        phoneNumber: phone,
        password: 'Password123!',
      }),
      authService.register({
        fullName: 'Concurrent 2',
        phoneNumber: phone,
        password: 'Password123!',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    // Đúng 1 UserSession được tạo
    const userSessions = sessionsStore.filter((s) => s.userId === (fulfilled[0] as any).value.userId);
    expect(userSessions).toHaveLength(1);
  });

  it('Test 13 — Login user tiếp tục tạo đúng 1 UserSession', async () => {
    const phone = getNextPhone();
    const rawPassword = 'Password123!';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const mockUser = {
      userId: 'existing-user-123',
      phoneNumber: phone,
      fullName: 'Login Normal',
      passwordHash,
      isActive: true,
      tokenVersion: 0,
      role: Role.FARMER,
    };
    usersStore.set(phone, mockUser);

    const loginRes = await authService.login(
      { phoneNumber: phone, password: rawPassword },
      'Chrome on Android',
    );

    expect(loginRes).toBeDefined();
    expect(loginRes.accessToken).toBeDefined();
    expect(loginRes.refreshToken).toBeDefined();

    const session = sessionsStore.find((s) => s.userId === mockUser.userId);
    expect(session).toBeDefined();
    expect(session.deviceName).toBe('Chrome on Android');
    expect(session.revokedAt).toBeNull();
  });
});
