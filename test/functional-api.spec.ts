import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { RateLimitService } from '../src/common/redis/rate-limit.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { UsersController } from '../src/modules/users/users.controller.js';
import { PondsService } from '../src/modules/ponds/ponds.service.js';
import { PondsController } from '../src/modules/ponds/ponds.controller.js';
import { DevicesService } from '../src/modules/devices/devices.service.js';
import { DevicesController } from '../src/modules/devices/devices.controller.js';
import { Role } from '../src/common/enums/role.enum.js';
import { DeviceStatus } from '../src/common/enums/device-status.enum.js';
import { JwtService } from '@nestjs/jwt';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

describe('FUNCTIONAL API TEST SUITE (PHASE 11)', () => {
  let redisService: RedisService;
  let rateLimitService: RateLimitService;
  let otpService: OtpService;
  let jwtService: JwtService;
  let configService: ConfigService;

  let authService: AuthService;
  let authController: AuthController;
  let usersService: UsersService;
  let usersController: UsersController;
  let pondsService: PondsService;
  let pondsController: PondsController;
  let devicesService: DevicesService;
  let devicesController: DevicesController;

  let usersStore: Map<string, any>;
  let sessionsStore: any[];
  let pondsStore: any[];
  let thresholdsStore: any[];
  let manualLogsStore: any[];
  let devicesStore: any[];

  const MANAGER_ID = 'manager-test-id';
  const testId = Date.now();
  let phoneSeq = 5000;
  let ipSeq = 1;
  const getNextPhone = () => `093${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;
  const getNextIp = () => `10.50.${Math.floor(ipSeq / 200)}.${(ipSeq++ % 200) + 1}`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: 'test_functional_jwt_access_secret_123456789012',
      JWT_REFRESH_SECRET: 'test_functional_jwt_refresh_secret_987654321098',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    rateLimitService = new RateLimitService(redisService);
    otpService = new OtpService(redisService);
    jwtService = new JwtService({ secret: 'test_functional_jwt_access_secret_123456789012' });

    const originalSignAsync = jwtService.signAsync.bind(jwtService);
    let signCounter = 0;
    vi.spyOn(jwtService, 'signAsync').mockImplementation(async (payload: any, options?: any) => {
      signCounter++;
      return originalSignAsync(payload, {
        ...options,
        jwtid: 'func-tok-' + signCounter + '-' + Math.random(),
      });
    });
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const keys = await client.keys('*:093*');
      if (keys.length > 0) {
        await redisService.del(...keys);
      }
      const rlKeys = await client.keys('rl:*');
      if (rlKeys.length > 0) {
        await redisService.del(...rlKeys);
      }
    }
    await redisService.onModuleDestroy();
  });
  beforeEach(() => {
    usersStore = new Map();
    sessionsStore = [];
    pondsStore = [];
    thresholdsStore = [];
    manualLogsStore = [];
    devicesStore = [];

    const usersRepo: any = {
      create: vi.fn((dto) => ({
        userId: 'u-' + Math.random(),
        tokenVersion: 0,
        isActive: true,
        role: dto.role || Role.FARMER,
        ...dto,
      })),
      save: vi.fn(async (u) => {
        if (!u.userId) u.userId = 'u-' + Math.random();
        usersStore.set(u.userId, u);
        return u;
      }),
      findOne: vi.fn(async (opt) => {
        if (opt.where?.userId) return usersStore.get(opt.where.userId) || null;
        if (opt.where?.phoneNumber) {
          for (const u of usersStore.values()) {
            if (u.phoneNumber === opt.where.phoneNumber) return u;
          }
        }
        return null;
      }),
      findAndCount: vi.fn(async () => {
        const list = Array.from(usersStore.values());
        return [list, list.length];
      }),
      update: vi.fn(async (criteria, updateData) => {
        const u = usersStore.get(criteria.userId);
        if (u) Object.assign(u, updateData);
        return { affected: u ? 1 : 0 };
      }),
      increment: vi.fn(async (criteria) => {
        const u = usersStore.get(criteria.userId);
        if (u) u.tokenVersion = (u.tokenVersion || 0) + 1;
        return { affected: u ? 1 : 0 };
      }),
      remove: vi.fn(async (u) => {
        usersStore.delete(u.userId);
        return u;
      }),
    };

    usersService = new UsersService(usersRepo);
    usersController = new UsersController(usersService);

    const userSessionRepo: any = {
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
    };

    const dataSource: any = {
      transaction: vi.fn(async (callback: any) => {
        const manager = {
          create: vi.fn((entity: any, data: any) => {
            if (entity === UserSession) {
              return {
                id: 'sess-' + Math.random(),
                createdAt: new Date(),
                lastUsedAt: new Date(),
                revokedAt: null,
                revokeReason: null,
                ...data,
              };
            }
            return {
              userId: 'u-' + Math.random(),
              tokenVersion: 0,
              isActive: true,
              role: data.role || Role.FARMER,
              ...data,
            };
          }),
          save: vi.fn(async (entity: any, record: any) => {
            if (entity === UserSession) {
              const index = sessionsStore.findIndex((s) => s.id === record.id);
              if (index >= 0) sessionsStore[index] = { ...sessionsStore[index], ...record };
              else sessionsStore.push(record);
              return record;
            }
            if (!record.userId) record.userId = 'u-' + Math.random();
            usersStore.set(record.userId, record);
            return record;
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
          getRepository: vi.fn(() => usersRepo),
        };
        return await callback(manager);
      }),
    };

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      userSessionRepo,
      dataSource,
      otpService,
    );
    authController = new AuthController(authService, usersService, rateLimitService);

    const pondRepo: any = {
      create: vi.fn((dto) => ({ pondId: 'pond-' + Math.random(), createdAt: new Date(), ...dto })),
      save: vi.fn(async (p) => {
        const idx = pondsStore.findIndex((x) => x.pondId === p.pondId);
        if (idx >= 0) pondsStore[idx] = p;
        else pondsStore.push(p);
        return p;
      }),
      findOne: vi.fn(async (opt) => pondsStore.find((p) => p.pondId === opt.where?.pondId) || null),
      findAndCount: vi.fn(async (opt) => {
        let list = pondsStore;
        if (opt?.where?.userId) list = list.filter((p) => p.userId === opt.where.userId);
        return [list, list.length];
      }),
      remove: vi.fn(async (p) => {
        pondsStore = pondsStore.filter((x) => x.pondId !== p.pondId);
        return p;
      }),
    };

    const thresholdRepo: any = {
      create: vi.fn((dto) => ({ configId: 'thresh-' + Math.random(), ...dto })),
      save: vi.fn(async (c) => {
        const idx = thresholdsStore.findIndex((x) => x.configId === c.configId);
        if (idx >= 0) thresholdsStore[idx] = c;
        else thresholdsStore.push(c);
        return c;
      }),
      findOne: vi.fn(async (opt) => thresholdsStore.find((c) => c.configId === opt.where?.configId) || null),
      find: vi.fn(async (opt) => thresholdsStore.filter((c) => c.pondId === opt.where?.pondId)),
      remove: vi.fn(async (c) => {
        thresholdsStore = thresholdsStore.filter((x) => x.configId !== c.configId);
        return c;
      }),
    };

    const manualLogRepo: any = {
      create: vi.fn((dto) => ({ logId: 'log-' + Math.random(), ...dto })),
      save: vi.fn(async (l) => {
        const idx = manualLogsStore.findIndex((x) => x.logId === l.logId);
        if (idx >= 0) manualLogsStore[idx] = l;
        else manualLogsStore.push(l);
        return l;
      }),
      findOne: vi.fn(async (opt) => manualLogsStore.find((l) => l.logId === opt.where?.logId) || null),
      findAndCount: vi.fn(async (opt) => {
        let list = manualLogsStore;
        if (opt?.where?.pondId) list = list.filter((l) => l.pondId === opt.where.pondId);
        return [list, list.length];
      }),
      remove: vi.fn(async (l) => {
        manualLogsStore = manualLogsStore.filter((x) => x.logId !== l.logId);
        return l;
      }),
    };

    pondsService = new PondsService(pondRepo, thresholdRepo, manualLogRepo);
    pondsController = new PondsController(pondsService);

    const deviceRepo: any = {
      create: vi.fn((dto) => ({ deviceId: 'dev-' + Math.random(), ...dto })),
      save: vi.fn(async (d) => {
        const idx = devicesStore.findIndex((x) => x.deviceId === d.deviceId);
        if (idx >= 0) devicesStore[idx] = d;
        else devicesStore.push(d);
        return d;
      }),
      findOne: vi.fn(async (opt) => {
        if (opt.where?.macAddress) return devicesStore.find((d) => d.macAddress === opt.where.macAddress) || null;
        return devicesStore.find((d) => d.deviceId === opt.where?.deviceId) || null;
      }),
      findAndCount: vi.fn(async (opt) => {
        let list = devicesStore;
        if (opt?.where?.pondId) list = list.filter((d) => d.pondId === opt.where.pondId);
        return [list, list.length];
      }),
      remove: vi.fn(async (d) => {
        devicesStore = devicesStore.filter((x) => x.deviceId !== d.deviceId);
        return d;
      }),
    };

    devicesService = new DevicesService(deviceRepo, pondRepo);
    devicesController = new DevicesController(devicesService);
  });
  // ==========================================
  // 1. AUTHENTICATION FUNCTIONAL FLOW
  // ==========================================
  describe('1. Authentication Functional APIs', () => {
    it('POST /auth/send-otp -> Valid phone sends OTP and returns 2xx message', async () => {
      const phone = getNextPhone();
      const res = await authController.sendOtp({ phoneNumber: phone });

      expect(res.message).toBeDefined();
      expect(res.phoneNumber).toBe(phone);
      expect(res.expiresIn).toBeDefined();
    });

    it('POST /auth/send-otp -> Phone already registered throws 409 Conflict', async () => {
      const phone = getNextPhone();
      usersStore.set('existing-user', { userId: 'existing-user', phoneNumber: phone, isActive: true });

      await expect(authController.sendOtp({ phoneNumber: phone })).rejects.toThrow(ConflictException);
    });

    it('POST /auth/verify-otp -> Correct OTP verifies phone successfully', async () => {
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(phone);

      const res = await authController.verifyOtp({ phoneNumber: phone, otp });
      expect(res.message).toBeDefined();
      expect(res.isValid).toBe(true);

      // Verify OTP marker exists in Redis
      expect(await otpService.isPhoneVerified(phone)).toBe(true);
    });

    it('POST /auth/verify-otp -> Wrong OTP throws 400 BadRequest', async () => {
      const phone = getNextPhone();
      await otpService.createAndSaveOtp(phone);

      await expect(authController.verifyOtp({ phoneNumber: phone, otp: '000000' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('POST /auth/register -> Valid registration creates User and UserSession', async () => {
      const phone = getNextPhone();
      await otpService.setPhoneVerified(phone);

      const res = await authController.register(
        {
          fullName: 'Nguyen Van A',
          phoneNumber: phone,
          password: 'Password123!',
        },
        '127.0.0.1',
        'Mozilla/5.0 (Windows NT 10.0)',
      );

      expect(res.message).toBeDefined();
      expect(res.userId).toBeDefined();
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();

      const user = usersStore.get(res.userId);
      expect(user).toBeDefined();
      expect(user.fullName).toBe('Nguyen Van A');
      expect(user.role).toBe(Role.FARMER);

      const session = sessionsStore.find((s) => s.userId === res.userId);
      expect(session).toBeDefined();
      expect(session.deviceName).toBe('Mozilla/5.0 (Windows NT 10.0)');
      expect(session.revokedAt).toBeNull();
    });

    it('POST /auth/register -> Missing OTP verification throws 400 BadRequest', async () => {
      const phone = getNextPhone();
      await expect(
        authController.register({
          fullName: 'No OTP',
          phoneNumber: phone,
          password: 'Password123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('POST /auth/login -> Valid credentials returns tokens and creates session', async () => {
      const phone = getNextPhone();
      const rawPassword = 'MySecretPassword123!';
      const passwordHash = await bcrypt.hash(rawPassword, 10);
      const user = {
        userId: 'user-login-test',
        phoneNumber: phone,
        fullName: 'Login User',
        passwordHash,
        role: Role.FARMER,
        tokenVersion: 0,
        isActive: true,
      };
      usersStore.set(user.userId, user);

      const res = await authController.login(
        { phoneNumber: phone, password: rawPassword },
        '127.0.0.1',
        'Safari on iPhone',
      );

      expect(res.userId).toBe(user.userId);
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();

      const session = sessionsStore.find((s) => s.userId === user.userId);
      expect(session).toBeDefined();
      expect(session.deviceName).toBe('Safari on iPhone');
    });

    it('POST /auth/login -> Wrong password throws 401 Unauthorized', async () => {
      const phone = getNextPhone();
      const ip = getNextIp();
      const passwordHash = await bcrypt.hash('CorrectPassword', 10);
      usersStore.set('u1', { userId: 'u1', phoneNumber: phone, passwordHash, isActive: true });

      await expect(
        authController.login({ phoneNumber: phone, password: 'WrongPassword' }, ip),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('POST /auth/login -> Inactive user throws 401 Unauthorized', async () => {
      const phone = getNextPhone();
      const ip = getNextIp();
      const passwordHash = await bcrypt.hash('CorrectPassword', 10);
      usersStore.set('u-inactive', { userId: 'u-inactive', phoneNumber: phone, passwordHash, isActive: false });

      await expect(
        authController.login({ phoneNumber: phone, password: 'CorrectPassword' }, ip),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('POST /auth/refresh -> Valid token rotates session and returns new tokens', async () => {
      const phone = getNextPhone();
      await otpService.setPhoneVerified(phone);
      const reg = await authController.register(
        {
          fullName: 'Refresh Tester',
          phoneNumber: phone,
          password: 'Password123!',
        },
        getNextIp(),
      );

      const initialSession = sessionsStore.find((s) => s.userId === reg.userId);
      const initialFamily = initialSession.tokenFamily;

      const refreshRes = await authController.refreshToken({ refreshToken: reg.refreshToken }, getNextIp());
      expect(refreshRes.accessToken).toBeDefined();
      expect(refreshRes.refreshToken).toBeDefined();
      expect(refreshRes.refreshToken).not.toBe(reg.refreshToken);

      expect(initialSession.revokedAt).not.toBeNull();
      expect(initialSession.revokeReason).toBe('ROTATED');

      const newHash = crypto.createHash('sha256').update(refreshRes.refreshToken).digest('hex');
      const newSession = sessionsStore.find((s) => s.refreshTokenHash === newHash);
      expect(newSession).toBeDefined();
      expect(newSession.tokenFamily).toBe(initialFamily);
    });

    it('POST /auth/refresh -> Reuse rotated token throws 401 and revokes family', async () => {
      const phone = getNextPhone();
      await otpService.setPhoneVerified(phone);
      const reg = await authController.register(
        {
          fullName: 'Reuse Tester',
          phoneNumber: phone,
          password: 'Password123!',
        },
        getNextIp(),
      );

      const rot = await authController.refreshToken({ refreshToken: reg.refreshToken }, getNextIp());

      await expect(authController.refreshToken({ refreshToken: reg.refreshToken }, getNextIp())).rejects.toThrow(
        UnauthorizedException,
      );

      const bHash = crypto.createHash('sha256').update(rot.refreshToken).digest('hex');
      const sessionB = sessionsStore.find((s) => s.refreshTokenHash === bHash);
      expect(sessionB.revokedAt).not.toBeNull();
      expect(sessionB.revokeReason).toBe('REUSE_DETECTED');
    });

    it('POST /auth/logout -> Revokes current device session with LOGOUT', async () => {
      const phone = getNextPhone();
      await otpService.setPhoneVerified(phone);
      const reg = await authController.register(
        {
          fullName: 'Logout Tester',
          phoneNumber: phone,
          password: 'Password123!',
        },
        getNextIp(),
      );

      const logoutRes = await authController.logout(reg.userId, { refreshToken: reg.refreshToken });
      expect(logoutRes.message).toBeDefined();

      const session = sessionsStore.find((s) => s.userId === reg.userId);
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokeReason).toBe('LOGOUT');
    });

    it('POST /auth/logout-all -> Increments tokenVersion and revokes all sessions with LOGOUT_ALL', async () => {
      const phone = getNextPhone();
      await otpService.setPhoneVerified(phone);
      const reg = await authController.register(
        {
          fullName: 'Logout All Tester',
          phoneNumber: phone,
          password: 'Password123!',
        },
        getNextIp(),
      );

      const res = await authController.logoutAll(reg.userId);
      expect(res.message).toBeDefined();

      const user = usersStore.get(reg.userId);
      expect(user.tokenVersion).toBe(1);

      const session = sessionsStore.find((s) => s.userId === reg.userId);
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokeReason).toBe('LOGOUT_ALL');
    });

    it('POST /auth/change-password -> Updates password, increments tokenVersion and revokes sessions', async () => {
      const phone = getNextPhone();
      const oldPass = 'OldPassword123!';
      const newPass = 'NewPassword123!';
      const passwordHash = await bcrypt.hash(oldPass, 10);
      const user = {
        userId: 'user-change-pass',
        phoneNumber: phone,
        fullName: 'Pass Changer',
        passwordHash,
        role: Role.FARMER,
        tokenVersion: 0,
        isActive: true,
      };
      usersStore.set(user.userId, user);

      const res = await authController.changePassword(user.userId, {
        currentPassword: oldPass,
        newPassword: newPass,
      });
      expect(res.message).toBeDefined();

      await expect(
        authController.login({ phoneNumber: phone, password: oldPass }, getNextIp()),
      ).rejects.toThrow(UnauthorizedException);

      const newLogin = await authController.login({ phoneNumber: phone, password: newPass }, getNextIp());
      expect(newLogin.accessToken).toBeDefined();
    });
  });

  // ==========================================
  // 2. USERS FUNCTIONAL CRUD FLOW
  // ==========================================
  describe('2. Users Functional APIs', () => {
    it('PATCH /users/profile -> Updates current user profile and returns sanitized user', async () => {
      const userId = 'u-prof-1';
      usersStore.set(userId, {
        userId,
        fullName: 'Old Name',
        phoneNumber: '0901111111',
        passwordHash: 'secret',
        role: Role.FARMER,
        isActive: true,
      });

      const res = await usersController.updateProfile(userId, {
        fullName: 'New Profile Name',
      });

      expect(res.message).toBeDefined();
      expect(res.user.fullName).toBe('New Profile Name');
      expect((res.user as any).passwordHash).toBeUndefined();
    });

    it('GET /users -> Manager lists all users with pagination', async () => {
      usersStore.set('u1', { userId: 'u1', fullName: 'User 1', role: Role.FARMER });
      usersStore.set('u2', { userId: 'u2', fullName: 'User 2', role: Role.FARMER });

      const res = await usersController.getAllUsers({ page: 1, limit: 10 });
      expect(res.total).toBe(2);
      expect(res.data).toHaveLength(2);
    });

    it('POST /users -> Manager creates user successfully', async () => {
      const res = await usersController.createUser({
        fullName: 'Created by Manager',
        phoneNumber: '0908887777',
        password: 'Password123!',
        role: Role.FARMER,
      });

      expect(res.message).toBeDefined();
      expect(res.user.fullName).toBe('Created by Manager');
      expect((res.user as any).passwordHash).toBeUndefined();
    });

    it('GET /users/:id -> Non-existent user throws 404 NotFound', async () => {
      await expect(
        usersController.getUserById('non-existent-id', 'admin-id', Role.MANAGER),
      ).rejects.toThrow(NotFoundException);
    });

    it('DELETE /users/:id -> Manager deletes user successfully', async () => {
      const userId = 'u-del-1';
      usersStore.set(userId, { userId, fullName: 'To Delete', isActive: true });

      const res = await usersController.deleteUser(userId);
      expect(res.message).toBeDefined();
      expect(usersStore.has(userId)).toBe(false);
    });
  });
  // ==========================================
  // 3. PONDS FUNCTIONAL CRUD FLOW
  // ==========================================
  describe('3. Ponds Functional APIs', () => {
    it('POST /ponds -> Creates pond for current user and returns 201', async () => {
      const userId = 'farmer-pond-1';
      const res = await pondsController.createPond(userId, Role.FARMER, {
        pondName: 'Ao So 1',
        areaM2: 1200.5,
        depthM: 1.8,
        shrimpDensity: 50,
      });

      expect(res.message).toBeDefined();
      expect(res.data.pondName).toBe('Ao So 1');
      expect(res.data.userId).toBe(userId);
      expect(res.data.pondId).toBeDefined();
      expect(pondsStore.some((p) => p.pondId === res.data.pondId)).toBe(true);
    });

    it('GET /ponds -> Lists ponds belonging to user with pagination', async () => {
      const userId = 'farmer-pond-2';
      pondsStore.push({ pondId: 'p1', userId, pondName: 'Ao 1' });
      pondsStore.push({ pondId: 'p2', userId, pondName: 'Ao 2' });
      pondsStore.push({ pondId: 'p3', userId: 'other-user', pondName: 'Ao 3' });

      const res = await pondsController.findAllPonds(userId, Role.FARMER, { page: 1, limit: 10 });
      expect(res.total).toBe(2);
      expect(res.data).toHaveLength(2);
      expect(res.data.every((p) => p.userId === userId)).toBe(true);
    });

    it('GET /ponds/:id -> Retrieves single pond details', async () => {
      const pondId = 'p-detail-1';
      const userId = 'farmer-pond-3';
      pondsStore.push({ pondId, userId, pondName: 'Ao Chi Tiet' });

      const res = await pondsController.findPondById(pondId, userId, Role.FARMER);
      expect(res.pondId).toBe(pondId);
      expect(res.pondName).toBe('Ao Chi Tiet');
    });

    it('PATCH /ponds/:id -> Updates pond properties', async () => {
      const pondId = 'p-patch-1';
      const userId = 'farmer-pond-4';
      pondsStore.push({ pondId, userId, pondName: 'Old Pond Name' });

      const res = await pondsController.updatePond(pondId, userId, Role.FARMER, {
        pondName: 'Updated Pond Name',
      });
      expect(res.message).toBeDefined();
      expect(res.data.pondName).toBe('Updated Pond Name');
      expect(pondsStore.find((p) => p.pondId === pondId).pondName).toBe('Updated Pond Name');
    });

    it('DELETE /ponds/:id -> Deletes pond successfully', async () => {
      const pondId = 'p-del-1';
      const userId = 'farmer-pond-5';
      pondsStore.push({ pondId, userId, pondName: 'Pond To Delete' });

      const res = await pondsController.deletePond(pondId, userId, Role.FARMER);
      expect(res.message).toBeDefined();
      expect(pondsStore.some((p) => p.pondId === pondId)).toBe(false);
    });
  });

  // ==========================================
  // 4. THRESHOLD CONFIG FUNCTIONAL APIS
  // ==========================================
  describe('4. Threshold Config Functional APIs', () => {
    it('POST /ponds/:id/thresholds -> Creates threshold config successfully', async () => {
      const pondId = 'pond-thresh-1';
      const userId = 'farmer-thresh-1';
      pondsStore.push({ pondId, userId, pondName: 'Ao Nguong' });

      const res = await pondsController.createThreshold(pondId, userId, Role.FARMER, {
        metricName: 'Temperature',
        minValue: 20,
        maxValue: 32,
      });

      expect(res.message).toBeDefined();
      expect(res.data.pondId).toBe(pondId);
      expect(res.data.metricName).toBe('Temperature');
      expect(res.data.configId).toBeDefined();
      expect(thresholdsStore.some((t) => t.configId === res.data.configId)).toBe(true);
    });

    it('POST /ponds/:id/thresholds -> Rejects if minValue > maxValue', async () => {
      const pondId = 'pond-thresh-2';
      const userId = 'farmer-thresh-2';
      pondsStore.push({ pondId, userId, pondName: 'Ao Nguong 2' });

      await expect(
        pondsController.createThreshold(pondId, userId, Role.FARMER, {
          metricName: 'Temperature',
          minValue: 35,
          maxValue: 25,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('GET /ponds/:id/thresholds -> Retrieves threshold configs for pond', async () => {
      const pondId = 'pond-thresh-3';
      const userId = 'farmer-thresh-3';
      pondsStore.push({ pondId, userId, pondName: 'Ao Nguong 3' });
      thresholdsStore.push({
        configId: 'th-1',
        pondId,
        metricName: 'pH',
        minValue: 7.5,
        maxValue: 8.5,
      });

      const res = await pondsController.findThresholdsByPond(pondId, userId, Role.FARMER);
      expect(res).toHaveLength(1);
      expect(res[0].metricName).toBe('pH');
    });

    it('DELETE /ponds/thresholds/:configId -> Deletes threshold config', async () => {
      const pondId = 'pond-thresh-4';
      const userId = 'farmer-thresh-4';
      const configId = 'th-del-1';
      const pond = { pondId, userId, pondName: 'Ao Nguong 4' };
      pondsStore.push(pond);
      thresholdsStore.push({ configId, pondId, pond, metricName: 'Salinity' });

      const res = await pondsController.deleteThreshold(configId, userId, Role.FARMER);
      expect(res.message).toBeDefined();
      expect(thresholdsStore.some((t) => t.configId === configId)).toBe(false);
    });
  });

  // ==========================================
  // 5. MANUAL TEST LOGS FUNCTIONAL APIS
  // ==========================================
  describe('5. Manual Test Logs Functional APIs', () => {
    it('POST /ponds/:id/manual-logs -> Creates manual water quality test log', async () => {
      const pondId = 'pond-log-1';
      const userId = 'farmer-log-1';
      pondsStore.push({ pondId, userId, pondName: 'Ao Nhat Ky' });

      const res = await pondsController.createManualLog(pondId, userId, Role.FARMER, {
        nh3Value: 0.5,
        no2Value: 0.2,
        note: 'Nuoc on dinh',
      });

      expect(res.message).toBeDefined();
      expect(res.data.logId).toBeDefined();
      expect(res.data.pondId).toBe(pondId);
      expect(res.data.nh3Value).toBe(0.5);
      expect(manualLogsStore.some((l) => l.logId === res.data.logId)).toBe(true);
    });

    it('GET /ponds/:id/manual-logs -> Retrieves manual logs with pagination', async () => {
      const pondId = 'pond-log-2';
      const userId = 'farmer-log-2';
      pondsStore.push({ pondId, userId, pondName: 'Ao Nhat Ky 2' });
      manualLogsStore.push({ logId: 'ml-1', pondId, nh3Value: 0.2, no2Value: 0.1, createdAt: new Date() });
      manualLogsStore.push({ logId: 'ml-2', pondId, nh3Value: 0.3, no2Value: 0.15, createdAt: new Date() });

      const res = await pondsController.findManualLogsByPond(pondId, userId, Role.FARMER, {
        page: 1,
        limit: 10,
      });
      expect(res.total).toBe(2);
      expect(res.data).toHaveLength(2);
    });

    it('PATCH /ponds/manual-logs/:logId -> Updates manual log entry', async () => {
      const pondId = 'pond-log-3';
      const userId = 'farmer-log-3';
      const logId = 'ml-patch-1';
      const pond = { pondId, userId, pondName: 'Ao Nhat Ky 3' };
      pondsStore.push(pond);
      manualLogsStore.push({ logId, pondId, pond, nh3Value: 0.2, no2Value: 0.1, note: 'Ban dau' });

      const res = await pondsController.updateManualLog(logId, userId, Role.FARMER, {
        note: 'Da cap nhat ghi chu',
      });
      expect(res.message).toBeDefined();
      expect(res.data.note).toBe('Da cap nhat ghi chu');
      expect(manualLogsStore.find((l) => l.logId === logId).note).toBe('Da cap nhat ghi chu');
    });

    it('DELETE /ponds/manual-logs/:logId -> Deletes manual log entry', async () => {
      const pondId = 'pond-log-4';
      const userId = 'farmer-log-4';
      const logId = 'ml-del-1';
      const pond = { pondId, userId, pondName: 'Ao Nhat Ky 4' };
      pondsStore.push(pond);
      manualLogsStore.push({ logId, pondId, pond, nh3Value: 0.2, no2Value: 0.1 });

      const res = await pondsController.deleteManualLog(logId, userId, Role.FARMER);
      expect(res.message).toBeDefined();
      expect(manualLogsStore.some((l) => l.logId === logId)).toBe(false);
    });
  });

  // ==========================================
  // 6. DEVICES FUNCTIONAL APIS
  // ==========================================
  describe('6. Devices Functional APIs', () => {
    it('POST /devices -> Registers new IoT device successfully', async () => {
      const pondId = 'pond-dev-1';
      const userId = 'farmer-dev-1';
      pondsStore.push({ pondId, userId, pondName: 'Ao Thiet Bi 1' });

      const res = await devicesController.createDevice(userId, Role.FARMER, {
        macAddress: 'AA:BB:CC:11:22:33',
        deviceName: 'Tram Do Node 1',
        pondId,
      });

      expect(res.message).toBeDefined();
      expect(res.data.deviceId).toBeDefined();
      expect(res.data.macAddress).toBe('AA:BB:CC:11:22:33');
      expect(devicesStore.some((d) => d.deviceId === res.data.deviceId)).toBe(true);
    });

    it('POST /devices -> Rejects registration if MAC address already exists', async () => {
      const pondId = 'pond-dev-2';
      const userId = 'farmer-dev-2';
      pondsStore.push({ pondId, userId, pondName: 'Ao Thiet Bi 2' });
      devicesStore.push({
        deviceId: 'dev-existing',
        macAddress: 'DUPLICATE:MAC:01',
        deviceName: 'Tram 1',
        pondId,
      });

      await expect(
        devicesController.createDevice(userId, Role.FARMER, {
          macAddress: 'DUPLICATE:MAC:01',
          deviceName: 'Tram 2',
          pondId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('GET /devices -> Lists devices with pagination', async () => {
      const userId = 'farmer-dev-3';
      const pond = { pondId: 'pond-dev-3', userId, pondName: 'Ao Dev 3' };
      pondsStore.push(pond);
      devicesStore.push({ deviceId: 'dev-1', pondId: pond.pondId, pond, deviceName: 'Dev 1', status: DeviceStatus.ACTIVE });
      devicesStore.push({ deviceId: 'dev-2', pondId: pond.pondId, pond, deviceName: 'Dev 2', status: DeviceStatus.INACTIVE });

      const res = await devicesController.findAllDevices(userId, Role.FARMER, { page: 1, limit: 10 });
      expect(res.total).toBe(2);
      expect(res.data).toHaveLength(2);
    });

    it('PATCH /devices/:id -> Updates device name, status, or reassigned pond', async () => {
      const userId = 'farmer-dev-4';
      const pond = { pondId: 'pond-dev-4', userId, pondName: 'Ao Dev 4' };
      const devId = 'dev-patch-1';
      pondsStore.push(pond);
      devicesStore.push({
        deviceId: devId,
        pondId: pond.pondId,
        pond,
        deviceName: 'Old Node Name',
        status: DeviceStatus.INACTIVE,
      });

      const res = await devicesController.updateDevice(devId, userId, Role.FARMER, {
        deviceName: 'New Node Name',
        status: DeviceStatus.ACTIVE,
      });
      expect(res.message).toBeDefined();
      expect(res.data.deviceName).toBe('New Node Name');
      expect(res.data.status).toBe(DeviceStatus.ACTIVE);
      expect(devicesStore.find((d) => d.deviceId === devId).status).toBe(DeviceStatus.ACTIVE);
    });

    it('DELETE /devices/:id -> Deletes IoT device', async () => {
      const userId = 'farmer-dev-5';
      const pond = { pondId: 'pond-dev-5', userId, pondName: 'Ao Dev 5' };
      const devId = 'dev-del-1';
      pondsStore.push(pond);
      devicesStore.push({ deviceId: devId, pondId: pond.pondId, pond, deviceName: 'To Delete Dev' });

      const res = await devicesController.deleteDevice(devId, userId, Role.FARMER);
      expect(res.message).toBeDefined();
      expect(devicesStore.some((d) => d.deviceId === devId)).toBe(false);
    });
  });

  // ==========================================
  // 7. END-TO-END MULTI-STEP BUSINESS FLOWS
  // ==========================================
  describe('7. End-to-End Multi-Step Business Flows', () => {
    it('Flow A: Farmer Lifecycle (OTP -> Register -> Login -> Create Pond -> Set Threshold -> Create Manual Log -> Change Password -> Old Token Invalid)', async () => {
      // 1. Request OTP & Verify OTP
      const phone = getNextPhone();
      const { otp } = await otpService.createAndSaveOtp(phone);
      const verifyRes = await authController.verifyOtp({ phoneNumber: phone, otp });
      expect(verifyRes.isValid).toBe(true);

      // 2. Register
      const reg = await authController.register({
        fullName: 'Le Van Nong Dan',
        phoneNumber: phone,
        password: 'Password123!',
      });
      expect(reg.accessToken).toBeDefined();
      const farmerId = reg.userId;

      // 3. Login
      const login = await authController.login({
        phoneNumber: phone,
        password: 'Password123!',
      });
      expect(login.accessToken).toBeDefined();

      // 4. Create Pond
      const pondRes = await pondsController.createPond(farmerId, Role.FARMER, {
        pondName: 'Ao Nuoi Tom Su 01',
        areaM2: 2500,
        depthM: 1.5,
        shrimpDensity: 60,
      });
      expect(pondRes.data.pondId).toBeDefined();
      const pondId = pondRes.data.pondId;

      // 5. Set Threshold
      const threshRes = await pondsController.createThreshold(pondId, farmerId, Role.FARMER, {
        metricName: 'DO',
        minValue: 4.0,
        maxValue: 8.0,
      });
      expect(threshRes.data.configId).toBeDefined();

      // 6. Manual Test Log
      const logRes = await pondsController.createManualLog(pondId, farmerId, Role.FARMER, {
        nh3Value: 0.1,
        no2Value: 0.05,
        note: 'Nuoc buoi sang rat tot',
      });
      expect(logRes.data.logId).toBeDefined();

      // 7. Change Password
      await authController.changePassword(farmerId, {
        currentPassword: 'Password123!',
        newPassword: 'NewPassword999!',
      });

      // 8. Old password fails
      await expect(
        authController.login({ phoneNumber: phone, password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);

      // 9. New password succeeds
      const newLogin = await authController.login({
        phoneNumber: phone,
        password: 'NewPassword999!',
      });
      expect(newLogin.accessToken).toBeDefined();
    });

    it('Flow B: Manager / Admin Lifecycle (Manager Creates User -> Assigns Device to Pond -> Reads System Overview)', async () => {
      // 1. Manager creates a new technician / farmer user
      const workerPhone = getNextPhone();
      const createdUser = await usersController.createUser({
        fullName: 'Nguyen Van Ky Thuat',
        phoneNumber: workerPhone,
        password: 'WorkerPassword123!',
        role: Role.FARMER,
      });
      expect(createdUser.user).toBeDefined();
      const workerId = (createdUser.user as any).userId;

      // 2. Worker has a pond
      const pondRes = await pondsController.createPond(workerId, Role.FARMER, {
        pondName: 'Ao Ky Thuat 1',
        areaM2: 3000,
        depthM: 2.0,
        shrimpDensity: 70,
      });
      const pondId = pondRes.data.pondId;

      // 3. Manager registers IoT device and assigns to pond
      const deviceRes = await devicesController.createDevice(MANAGER_ID, Role.MANAGER, {
        macAddress: 'E4:5F:01:23:45:67',
        deviceName: 'Tram Do Tu Dong 01',
        pondId,
      });
      expect(deviceRes.data.deviceId).toBeDefined();
      expect(deviceRes.data.pondId).toBe(pondId);

      // 4. Manager queries system users & devices
      const usersList = await usersController.getAllUsers({ page: 1, limit: 10 });
      expect(usersList.total).toBeGreaterThanOrEqual(1);

      const devicesList = await devicesController.findAllDevices(MANAGER_ID, Role.MANAGER, { page: 1, limit: 10 });
      expect(devicesList.total).toBeGreaterThanOrEqual(1);
    });
  });
});
