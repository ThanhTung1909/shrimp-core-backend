import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { Role } from '../src/common/enums/role.enum.js';

describe('password login protection', () => {
  let passwordHash: string;
  let user: any;
  let attempts: number;
  let lockTtl: number;
  let loginSecurity: any;
  let users: any;
  let auth: AuthService;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('CorrectPassword', 4);
  });

  beforeEach(() => {
    attempts = 0;
    lockTtl = -2;
    user = {
      userId: 'user-1',
      fullName: 'Test User',
      phoneNumber: '0912345678',
      passwordHash,
      role: Role.FARMER,
      isActive: true,
      isLoginLocked: false,
      tokenVersion: 0,
      mustChangePassword: false,
    };
    loginSecurity = {
      getTemporaryLockTtl: vi.fn(async () => lockTtl),
      recordFailure: vi.fn(async () => ++attempts),
      createTemporaryLock: vi.fn(async (_id: string, seconds: number) => {
        lockTtl = seconds;
      }),
      clear: vi.fn(async () => {
        attempts = 0;
        lockTtl = -2;
      }),
    };
    users = {
      findByPhoneNumber: vi.fn(async () => user),
      setLoginLocked: vi.fn(async () => {
        user.isLoginLocked = true;
      }),
    };
    auth = new AuthService(
      users,
      {
        signAsync: vi.fn(async () => 'token'),
        decode: vi.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 3600 })),
      } as any,
      { get: vi.fn(() => 'secret') } as any,
      { create: vi.fn((value) => value), save: vi.fn(async (value) => value) } as any,
      {} as any,
      {} as any,
      undefined,
      loginSecurity,
    );
  });

  const fail = () =>
    expect(
      auth.login({ phoneNumber: user?.phoneNumber ?? '0999999999', password: 'WrongPassword' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

  it('applies only the exact 3/5/10 milestones and preserves the counter across TTL expiry', async () => {
    await fail();
    await fail();
    expect(attempts).toBe(2);
    expect(loginSecurity.createTemporaryLock).not.toHaveBeenCalled();

    await fail();
    expect(attempts).toBe(3);
    expect(loginSecurity.createTemporaryLock).toHaveBeenLastCalledWith('user-1', 30);

    await fail();
    expect(attempts).toBe(3);
    expect(loginSecurity.recordFailure).toHaveBeenCalledTimes(3);

    lockTtl = -2;
    await fail();
    expect(attempts).toBe(4);
    expect(loginSecurity.createTemporaryLock).toHaveBeenCalledTimes(1);

    await fail();
    expect(attempts).toBe(5);
    expect(loginSecurity.createTemporaryLock).toHaveBeenLastCalledWith('user-1', 60);

    await fail();
    expect(attempts).toBe(5);
    lockTtl = -2;

    for (const expected of [6, 7, 8, 9]) {
      await fail();
      expect(attempts).toBe(expected);
      expect(loginSecurity.createTemporaryLock).toHaveBeenCalledTimes(2);
    }

    await fail();
    expect(users.setLoginLocked).toHaveBeenCalledWith('user-1', true);
    expect(loginSecurity.clear).toHaveBeenCalledWith('user-1');
    expect(user.isActive).toBe(true);
  });

  it('does not compare or increment while permanently locked', async () => {
    user.isLoginLocked = true;
    await fail();
    expect(loginSecurity.recordFailure).not.toHaveBeenCalled();
  });

  it('does not create or send OTP for a permanently locked account', async () => {
    user.isLoginLocked = true;
    const createAndSaveOtp = vi.fn();
    auth = new AuthService(
      users,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { createAndSaveOtp } as any,
      loginSecurity,
    );

    await expect(
      auth.sendOtp({ phoneNumber: user.phoneNumber, purpose: 'LOGIN' }),
    ).rejects.toThrow('Vui lòng liên hệ quản lý');
    expect(createAndSaveOtp).not.toHaveBeenCalled();
  });

  it('does not create account security state for an unknown account', async () => {
    user = null;
    await fail();
    expect(loginSecurity.getTemporaryLockTtl).not.toHaveBeenCalled();
    expect(loginSecurity.recordFailure).not.toHaveBeenCalled();
    expect(users.setLoginLocked).not.toHaveBeenCalled();
  });

  it('clears failed and temporary state only after a successful login', async () => {
    attempts = 2;
    await auth.login({ phoneNumber: user.phoneNumber, password: 'CorrectPassword' });
    expect(loginSecurity.clear).toHaveBeenCalledWith('user-1');
    expect(attempts).toBe(0);
  });
});

describe('management password-login unlock authorization', () => {
  const actor = 'actor-id';
  const target = 'target-id';

  function service(targetRole: Role) {
    const repo = {
      findOne: vi.fn(async () => ({
        userId: target,
        role: targetRole,
        isLoginLocked: true,
        isActive: true,
        passwordHash: 'unchanged',
      })),
      update: vi.fn(async () => ({ affected: 1 })),
    };
    const security = { clear: vi.fn(async () => undefined) };
    return { users: new UsersService(repo as any, security as any), repo, security };
  }

  it.each([
    [Role.ADMIN, Role.FARMER],
    [Role.ADMIN, Role.MANAGER],
    [Role.ADMIN, Role.ADMIN],
    [Role.MANAGER, Role.FARMER],
  ])('allows %s to unlock %s', async (actorRole, targetRole) => {
    const { users, repo, security } = service(targetRole);
    await users.unlockPasswordLogin(actor, actorRole, target);
    expect(repo.update).toHaveBeenCalledWith({ userId: target }, { isLoginLocked: false });
    expect(security.clear).toHaveBeenCalledWith(target);
  });

  it.each([
    [Role.MANAGER, Role.MANAGER],
    [Role.MANAGER, Role.ADMIN],
    [Role.FARMER, Role.FARMER],
  ])('denies %s from unlocking %s', async (actorRole, targetRole) => {
    const { users } = service(targetRole);
    await expect(users.unlockPasswordLogin(actor, actorRole, target)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([Role.ADMIN, Role.MANAGER, Role.FARMER])('denies %s self-unlock', async (role) => {
    const { users } = service(Role.FARMER);
    await expect(users.unlockPasswordLogin(actor, role, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('login again after an expired session', () => {
  it('resets the account-specific limiter after every successful Password Login', async () => {
    const login = vi.fn(async () => ({ accessToken: 'new-access-token' }));
    const checkLimit = vi.fn(async () => ({
      allowed: true,
      count: 1,
      remaining: 9,
      retryAfterSeconds: 0,
    }));
    const resetLimit = vi.fn(async () => undefined);
    const controller = new AuthController(
      { login } as any,
      {} as any,
      { checkLimit, resetLimit } as any,
    );

    for (let attempt = 0; attempt < 6; attempt++) {
      await controller.login(
        { phoneNumber: '0912345678', password: 'CorrectPassword' },
        '127.0.0.1',
      );
    }

    expect(login).toHaveBeenCalledTimes(6);
    expect(checkLimit).toHaveBeenCalledTimes(12);
    expect(resetLimit).toHaveBeenCalledTimes(6);
    expect(
      resetLimit.mock.calls.every(([key]) => key.startsWith('rl:login:phone:')),
    ).toBe(true);
  });
});
