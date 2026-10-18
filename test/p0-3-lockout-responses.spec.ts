import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';
import { Role } from '../src/common/enums/role.enum.js';
import { LoginLockoutService, type AfterCommit, type LoginLockoutState } from '../src/common/redis/login-lockout.service.js';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter.js';
import {
  LOCKOUT_ERROR_CODES,
  LOCKOUT_MESSAGES,
} from '../src/common/redis/login-lockout.constants.js';

describe('TASK P0-3: Account Lockout API Responses Only', () => {
  const password = 'TestPassword@2026';
  let passwordHash: string;
  let user: User;
  let service: AuthService;
  let lockout: LoginLockoutService;
  let state: LoginLockoutState;
  let sessions: Array<Partial<UserSession>>;
  let manager: any;
  let users: any;
  let jwt: any;
  let sessionRepository: any;

  // Filter helper to simulate full HTTP response from AllExceptionsFilter
  function executeFilter(exception: unknown, path = '/auth/login'): {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
  } {
    const filter = new AllExceptionsFilter();
    const headers: Record<string, string> = {};
    let capturedBody: any;
    let capturedStatus = 500;

    const mockResponse = {
      status: vi.fn((code: number) => {
        capturedStatus = code;
        return mockResponse;
      }),
      json: vi.fn((body: any) => {
        capturedBody = body;
        return mockResponse;
      }),
      setHeader: vi.fn((key: string, value: string) => {
        headers[key] = value;
      }),
    };

    const mockRequest = {
      url: path,
      originalUrl: path,
    };

    const mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as any;

    filter.catch(exception, mockHost);

    return {
      statusCode: capturedStatus,
      body: capturedBody,
      headers,
    };
  }

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
  });

  beforeEach(() => {
    user = Object.assign(new User(), {
      userId: '00000000-0000-4000-8000-000000000001',
      fullName: 'P0-3 Lockout Response Test',
      phoneNumber: '0987654321',
      email: 'p03@example.com',
      passwordHash,
      role: Role.FARMER,
      isActive: true,
      isLocked: false,
      tokenVersion: 1,
      mustChangePassword: false,
    });
    state = { attempts: 0, tempTtl: 0, pendingManual: false };
    sessions = [{ userId: user.userId, revokedAt: null, tokenFamily: 'test-family' }];

    manager = {
      create: vi.fn((_entity: unknown, values: object) => ({ ...values, revokedAt: null })),
      save: vi.fn(async (_entity: unknown, value: any) => value),
      update: vi.fn(async (_entity: unknown, criteria: any, values: any) => {
        for (const s of sessions) {
          if (s.userId === criteria.userId && s.revokedAt === null) Object.assign(s, values);
        }
        return { affected: 1 };
      }),
      findOne: vi.fn(async () => sessions[0]),
    };

    lockout = new LoginLockoutService({} as any, {} as any);
    vi.spyOn(lockout, 'getState').mockImplementation(async () => ({ ...state }));
    vi.spyOn(lockout, 'recordFailure').mockImplementation(async () => {
      state.attempts += 1;
      if (state.attempts === 3) state.tempTtl = 30;
      if (state.attempts >= 5) state.pendingManual = true;
      return { ...state };
    });
    vi.spyOn(lockout, 'resetLoginFailureState').mockImplementation(async (_id, _reason, manualUnlock = false) => {
      state.attempts = 0;
      state.tempTtl = 0;
      if (manualUnlock) state.pendingManual = false;
    });
    vi.spyOn(lockout, 'withUserLock').mockImplementation(async (
      _id: string,
      callback: (current: User | null, tx: any, afterCommit: AfterCommit) => Promise<any>,
    ) => {
      const jobs: Array<() => Promise<void>> = [];
      const result = await callback(user, manager, (job) => jobs.push(job));
      for (const job of jobs) await job();
      return result;
    });

    users = {
      findByPhoneNumber: vi.fn(async (phone: string) => (phone === user.phoneNumber ? user : null)),
      findByNormalizedEmail: vi.fn(async () => user),
      findById: vi.fn(async () => user),
      updatePassword: vi.fn(async (_id: string, newHash: string) => {
        user.passwordHash = newHash;
      }),
      incrementTokenVersion: vi.fn(async () => ++user.tokenVersion),
    };

    jwt = {
      signAsync: vi.fn(async (payload: any) => `${payload.type}-token`),
      decode: vi.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 3600 })),
      verifyAsync: vi.fn(async () => ({ sub: user.userId, type: 'refresh', tokenVersion: 1 })),
    };

    sessionRepository = { findOne: vi.fn(async () => sessions[0]), update: vi.fn() };

    service = new AuthService(
      users,
      jwt as JwtService,
      new ConfigService({
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
      }),
      sessionRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      lockout,
    );
  });

  const login = (phone = user.phoneNumber, pass = password) =>
    service.login({ phoneNumber: phone, password: pass });

  // 1. Sai mật khẩu thông thường -> Giữ nguyên response chung (401)
  it('1. Sai mật khẩu thông thường (attempt 1, 2, 4): giữ nguyên response 401 chung', async () => {
    state.attempts = 0;
    try {
      await login(user.phoneNumber, 'WrongPassword123!');
      expect.fail('Must throw on wrong password');
    } catch (error) {
      const res = executeFilter(error);
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 401,
        message: 'Số điện thoại hoặc mật khẩu không đúng!',
        errorCode: 'UNAUTHORIZED',
        path: '/auth/login',
      });
      expect(res.body).not.toHaveProperty('retryAfterSeconds');
      expect(res.headers).not.toHaveProperty('Retry-After');
    }
  });

  // 1b. Sai mật khẩu với tài khoản không tồn tại -> Giữ nguyên response chung, không tiết lộ tài khoản
  it('1b. Tài khoản không tồn tại: trả về 401 chung không tiết lộ tồn tại', async () => {
    try {
      await login('0900000000', 'AnyPassword123!');
      expect.fail('Must throw on unknown phone');
    } catch (error) {
      const res = executeFilter(error);
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 401,
        message: 'Số điện thoại hoặc mật khẩu không đúng!',
        errorCode: 'UNAUTHORIZED',
        path: '/auth/login',
      });
    }
  });

  // 2. Khóa tạm thời 30 giây -> ACCOUNT_TEMPORARILY_LOCKED, HTTP 429
  it('2. Khóa tạm thời (attempt 3): trả về 429 với errorCode ACCOUNT_TEMPORARILY_LOCKED', async () => {
    state.attempts = 2; // Next failure is 3rd -> triggers temporary lock
    try {
      await login(user.phoneNumber, 'WrongPassword123!');
      expect.fail('Must throw temporary lock on 3rd wrong attempt');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);

      const res = executeFilter(error);
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 429,
        message: LOCKOUT_MESSAGES.TEMPORARILY_LOCKED,
        errorCode: LOCKOUT_ERROR_CODES.TEMPORARILY_LOCKED,
        retryAfterSeconds: 30,
        path: '/auth/login',
      });
      expect(res.body.timestamp).toBeDefined();
      expect(res.headers['Retry-After']).toBe('30');
    }
  });

  // 3. Khóa tạm thời có TTL còn lại -> retryAfterSeconds phản ánh thời gian thực tế
  it('3. Khóa tạm thời có TTL (còn 21 giây): retryAfterSeconds phản ánh thời gian còn lại thực tế', async () => {
    state = { attempts: 3, tempTtl: 21, pendingManual: false };
    try {
      await login(user.phoneNumber, password);
      expect.fail('Must reject during temporary lock cooldown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);

      const res = executeFilter(error);
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 429,
        message: LOCKOUT_MESSAGES.TEMPORARILY_LOCKED,
        errorCode: LOCKOUT_ERROR_CODES.TEMPORARILY_LOCKED,
        retryAfterSeconds: 21,
        path: '/auth/login',
      });
      expect(res.headers['Retry-After']).toBe('21');
    }
  });

  // 4. Khóa chờ ADMIN/MANAGER mở -> ACCOUNT_PENDING_ADMIN_UNLOCK, HTTP 423
  it('4. Khóa chờ ADMIN (attempt 5): trả về 423 với errorCode ACCOUNT_PENDING_ADMIN_UNLOCK', async () => {
    state.attempts = 4; // Next failure is 5th -> triggers manual lock
    try {
      await login(user.phoneNumber, 'WrongPassword123!');
      expect.fail('Must throw manual lock on 5th wrong attempt');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(423);

      const res = executeFilter(error);
      expect(res.statusCode).toBe(423);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 423,
        message: LOCKOUT_MESSAGES.PENDING_ADMIN_UNLOCK,
        errorCode: LOCKOUT_ERROR_CODES.PENDING_ADMIN_UNLOCK,
        path: '/auth/login',
      });
      expect(res.body).not.toHaveProperty('retryAfterSeconds');
      expect(res.headers).not.toHaveProperty('Retry-After');
      expect(user.isLocked).toBe(true);
    }
  });

  // 4b. Tài khoản đang bị khóa (isLocked = true): trả về 423 ACCOUNT_PENDING_ADMIN_UNLOCK
  it('4b. Đăng nhập khi tài khoản đã bị khóa (isLocked = true): trả về 423 ACCOUNT_PENDING_ADMIN_UNLOCK', async () => {
    user.isLocked = true;
    try {
      await login(user.phoneNumber, password);
      expect.fail('Must reject locked account');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(423);

      const res = executeFilter(error);
      expect(res.statusCode).toBe(423);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 423,
        message: LOCKOUT_MESSAGES.PENDING_ADMIN_UNLOCK,
        errorCode: LOCKOUT_ERROR_CODES.PENDING_ADMIN_UNLOCK,
        path: '/auth/login',
      });
      expect(res.body).not.toHaveProperty('retryAfterSeconds');
    }
  });

  // 4c. Tài khoản có pendingManual = true trong Redis: trả về 423 ACCOUNT_PENDING_ADMIN_UNLOCK
  it('4c. Đăng nhập khi pendingManual = true trong Redis: trả về 423 ACCOUNT_PENDING_ADMIN_UNLOCK', async () => {
    state = { attempts: 5, tempTtl: 0, pendingManual: true };
    try {
      await login(user.phoneNumber, password);
      expect.fail('Must reject pending manual state');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(423);

      const res = executeFilter(error);
      expect(res.statusCode).toBe(423);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 423,
        message: LOCKOUT_MESSAGES.PENDING_ADMIN_UNLOCK,
        errorCode: LOCKOUT_ERROR_CODES.PENDING_ADMIN_UNLOCK,
        path: '/auth/login',
      });
    }
  });

  // 5. Tài khoản được Unlock -> Không còn response pending-admin
  it('5. Tài khoản được Unlock: không còn response pending-admin', async () => {
    // Ban đầu tài khoản bị khóa
    user.isLocked = true;
    state = { attempts: 5, tempTtl: 0, pendingManual: true };

    // Mô phỏng Admin Unlock (gỡ cờ isLocked trong DB, reset failure state trong Redis)
    user.isLocked = false;
    await lockout.resetLoginFailureState(user.userId, 'MANUAL_UNLOCK', true);
    expect(state.pendingManual).toBe(false);
    expect(state.attempts).toBe(0);

    // Khi đăng nhập với mật khẩu đúng -> Thành công, không bị chặn
    const successRes = await login(user.phoneNumber, password);
    expect(successRes.accessToken).toBe('access-token');

    // Khi đăng nhập với mật khẩu sai -> Trả về 401 thông thường, KHÔNG PHẢI pending-admin
    try {
      await login(user.phoneNumber, 'WrongPass!');
      expect.fail('Must throw 401 on wrong pass');
    } catch (error) {
      const res = executeFilter(error);
      expect(res.statusCode).toBe(401);
      expect(res.body.errorCode).toBe('UNAUTHORIZED');
      expect(res.body.message).toBe('Số điện thoại hoặc mật khẩu không đúng!');
    }
  });

  // 6. Đăng nhập thành công -> Response không thay đổi
  it('6. Đăng nhập thành công: response không thay đổi', async () => {
    user.isLocked = false;
    state = { attempts: 0, tempTtl: 0, pendingManual: false };

    const result = await login(user.phoneNumber, password);
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.userId).toBe(user.userId);
    expect(result.phoneNumber).toBe(user.phoneNumber);
    expect(result.role).toBe(user.role);
    expect(result.tokenVersion).toBe(user.tokenVersion);
  });

  // 7. Redis/PostgreSQL state: không có thay đổi ngoài hành vi hiện tại
  it('7. State integrity: không tạo thêm key/state mới, giữ nguyên cơ chế lockout hiện tại', async () => {
    // 3rd attempt đặt tempTtl = 30
    state.attempts = 2;
    await expect(login(user.phoneNumber, 'WrongPass!')).rejects.toMatchObject({ status: 429 });
    expect(state.attempts).toBe(3);
    expect(state.tempTtl).toBe(30);

    // 4th attempt không đổi TTL
    state.tempTtl = 0; // cooldown hết hạn
    await expect(login(user.phoneNumber, 'WrongPass!')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.attempts).toBe(4);

    // 5th attempt đặt pendingManual và cập nhật user.isLocked
    await expect(login(user.phoneNumber, 'WrongPass!')).rejects.toMatchObject({ status: 423 });
    expect(state.attempts).toBe(5);
    expect(state.pendingManual).toBe(true);
    expect(user.isLocked).toBe(true);
  });
});
