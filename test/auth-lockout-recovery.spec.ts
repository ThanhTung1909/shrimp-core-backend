import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { UserSession } from '../src/modules/auth/entities/user-session.entity.js';
import { Role } from '../src/common/enums/role.enum.js';
import { OtpPurpose } from '../src/common/redis/otp.constants.js';
import { LoginLockoutService, type AfterCommit, type LoginLockoutState } from '../src/common/redis/login-lockout.service.js';

/**
 * These tests exercise authentication contracts without touching real users or Redis.
 * The transaction boundary runs cleanup only after a simulated durable commit.
 * Redis timing/atomicity is covered separately by LoginLockoutService integration tests.
 */
describe('P0-3 authentication recovery and durable login locks', () => {
  const password = 'RecoveryTest@2026';
  let passwordHash: string;
  let user: User;
  let service: AuthService;
  let lockout: LoginLockoutService;
  let state: LoginLockoutState;
  let events: string[];
  let sessions: Array<Partial<UserSession>>;
  let manager: any;
  let users: any;
  let otp: any;
  let jwt: any;
  let sessionRepository: any;

  beforeAll(async () => { passwordHash = await bcrypt.hash(password, 4); });

  beforeEach(() => {
    user = Object.assign(new User(), {
      userId: '00000000-0000-4000-8000-000000000001',
      fullName: 'Isolated Recovery Test', phoneNumber: '0999123456',
      email: 'recovery@example.invalid', passwordHash, role: Role.FARMER,
      isActive: true, isLocked: false,
      tokenVersion: 1, mustChangePassword: false,
    });
    state = { attempts: 2, tempTtl: 0, pendingManual: false };
    events = [];
    sessions = [{ userId: user.userId, revokedAt: null, tokenFamily: 'test-family' }];
    manager = {
      create: vi.fn((_entity: unknown, values: object) => ({ ...values, revokedAt: null })),
      save: vi.fn(async (entity: unknown, value: any) => {
        if (entity === User) events.push('persist-lock');
        if (entity === UserSession) {
          events.push('save-session');
          sessions.push(value);
        }
        return value;
      }),
      update: vi.fn(async (_entity: unknown, criteria: any, values: any) => {
        events.push(`revoke:${values.revokeReason}`);
        for (const session of sessions) {
          if (session.userId === criteria.userId && session.revokedAt === null) Object.assign(session, values);
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
    vi.spyOn(lockout, 'resetLoginFailureState').mockImplementation(async (_id, reason, manualUnlock = false) => {
      events.push(`reset:${reason}`);
      state.attempts = 0;
      state.tempTtl = 0;
      if (manualUnlock) state.pendingManual = false;
    });
    vi.spyOn(lockout, 'withUserLock').mockImplementation(async (
      _id: string,
      callback: (current: User | null, tx: EntityManager, afterCommit: AfterCommit) => Promise<any>,
    ) => {
      const snapshot = { ...user };
      const savedSessions = sessions.map((session) => ({ ...session }));
      const jobs: Array<() => Promise<void>> = [];
      events.push('begin');
      try {
        const result = await callback(user, manager, (job) => jobs.push(job));
        events.push('commit');
        for (const job of jobs) await job();
        return result;
      } catch (error) {
        if (!events.includes('commit')) {
          Object.assign(user, snapshot);
          sessions = savedSessions;
          events.push('rollback');
        }
        throw error;
      }
    });
    users = {
      findByPhoneNumber: vi.fn(async () => user),
      findByNormalizedEmail: vi.fn(async () => user),
      findById: vi.fn(async () => user),
      updatePassword: vi.fn(async (_id: string, newHash: string) => {
        events.push('update-password');
        user.passwordHash = newHash;
        user.mustChangePassword = false;
      }),
      incrementTokenVersion: vi.fn(async () => {
        events.push('increment-version');
        return ++user.tokenVersion;
      }),
    };
    otp = {
      verifyOtp: vi.fn(async () => undefined),
      consumePhoneVerified: vi.fn(async () => true),
    };
    jwt = {
      signAsync: vi.fn(async (payload: any) => `${payload.type}-token`),
      decode: vi.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 3600 })),
      verifyAsync: vi.fn(async () => ({ sub: user.userId, type: 'refresh', tokenVersion: 1 })),
    };
    sessionRepository = { findOne: vi.fn(async () => sessions[0]), update: vi.fn() };
    service = new AuthService(users, jwt as JwtService, new ConfigService({
      JWT_ACCESS_SECRET: 'isolated-test-access-secret', JWT_REFRESH_SECRET: 'isolated-test-refresh-secret',
    }), sessionRepository, {} as any, {} as any, {} as any, otp, {} as any, lockout);
  });

  const login = (phoneNumber = '0999123456', value = password) => service.login({ phoneNumber, password: value });
  const otpLogin = () => service.verifyOtp({ phoneNumber: user.phoneNumber, otp: '837492', purpose: OtpPurpose.LOGIN });
  const changePassword = () => service.changePassword(user.userId, {
    currentPassword: password, newPassword: 'ChangedRecovery@2026', otp: '837492',
  });

  it('resets failures only after the password login session is committed', async () => {
    const result = await login();
    expect(result.accessToken).toBe('access-token');
    expect(events).toEqual(['begin', 'save-session', 'commit', 'reset:PASSWORD_LOGIN']);
    expect(state).toEqual({ attempts: 0, tempTtl: 0, pendingManual: false });
  });

  it('does not reset failures when saving the password login session fails', async () => {
    manager.save.mockRejectedValueOnce(new Error('session write failed'));
    await expect(login()).rejects.toThrow('session write failed');
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(events).toContain('rollback');
    expect(state.attempts).toBe(2);
  });

  it('denies password login under a durable lock without issuing tokens', async () => {
    user.isLocked = true;
    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(lockout.recordFailure).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(user.isLocked).toBe(true);
  });

  it('fails closed before password authentication when Redis state is unavailable', async () => {
    vi.mocked(lockout.getState).mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(login()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('returns 401 only after fifth failure persists the manual lock and revokes sessions', async () => {
    state.attempts = 4;
    await expect(login(user.phoneNumber, 'WrongRecovery@2026')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events).toEqual(['begin', 'persist-lock', 'revoke:LOGIN_FAILED_LOCK', 'commit']);
    expect(user).toMatchObject({ isLocked: true, tokenVersion: 2 });
    expect(sessions[0]).toMatchObject({ revokeReason: 'LOGIN_FAILED_LOCK', revokedAt: expect.any(Date) });
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('repairs a pending fifth-failure durable lock before returning generic 401', async () => {
    state = { attempts: 5, tempTtl: 0, pendingManual: true };
    await expect(login()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events).toEqual(['begin', 'persist-lock', 'revoke:LOGIN_FAILED_LOCK', 'commit']);
    expect(lockout.recordFailure).not.toHaveBeenCalled();
    expect(user.isLocked).toBe(true);
  });

  it('denies even a correct password during cooldown without incrementing the counter', async () => {
    state = { attempts: 3, tempTtl: 21, pendingManual: false };
    await expect(login()).rejects.toMatchObject({ status: 429 });
    expect(lockout.recordFailure).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(state.attempts).toBe(3);
  });

  it('uses the same rejection for unknown account and an existing account with a wrong password', async () => {
    state.attempts = 0;
    const knownFailure = await login(user.phoneNumber, 'WrongRecovery@2026').catch((error: HttpException) => error);
    state.attempts = 0;
    users.findByPhoneNumber.mockResolvedValueOnce(null);
    const unknownFailure = await login('0999123457', 'WrongRecovery@2026').catch((error: HttpException) => error);
    expect(unknownFailure.getResponse()).toEqual(knownFailure.getResponse());
    expect(lockout.recordFailure).toHaveBeenLastCalledWith(expect.stringMatching(/^unknown:[a-f0-9]{64}$/), false);
  });

  it('consumes a verified LOGIN OTP once and resets failures after session commit', async () => {
    state.tempTtl = 20;
    const result = await otpLogin();
    expect(result.accessToken).toBe('access-token');
    expect(otp.consumePhoneVerified).toHaveBeenCalledWith(OtpPurpose.LOGIN, user.phoneNumber);
    expect(events).toEqual(['begin', 'save-session', 'commit', 'reset:OTP_LOGIN']);
    expect(state.attempts).toBe(0);
    expect(state.tempTtl).toBe(0);
  });

  it('does not reset failures or issue a session for a wrong OTP', async () => {
    otp.verifyOtp.mockRejectedValueOnce(new BadRequestException('Invalid OTP'));
    await expect(otpLogin()).rejects.toBeInstanceOf(BadRequestException);
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(otp.consumePhoneVerified).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('cannot issue tokens from a reused LOGIN OTP marker', async () => {
    otp.consumePhoneVerified.mockResolvedValueOnce(false);
    await expect(otpLogin()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('does not allow a valid LOGIN OTP to bypass a durable lock', async () => {
    user.isLocked = true;
    await expect(otpLogin()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(otp.consumePhoneVerified).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(user).toMatchObject({ isLocked: true });
  });

  it('does not reset failures if the OTP login session transaction rolls back', async () => {
    manager.save.mockRejectedValueOnce(new Error('session write failed'));
    await expect(otpLogin()).rejects.toThrow('session write failed');
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(events).toContain('rollback');
  });

  it('resets failures after password change persists password, revocation and the replacement session', async () => {
    state.tempTtl = 10;
    await changePassword();
    expect(events).toEqual([
      'begin', 'update-password', 'increment-version', 'revoke:PASSWORD_CHANGED',
      'save-session', 'commit', 'reset:PASSWORD_CHANGE',
    ]);
    expect(await bcrypt.compare('ChangedRecovery@2026', user.passwordHash)).toBe(true);
    expect(state.attempts).toBe(0);
    expect(state.tempTtl).toBe(0);
  });

  it('does not reset on an incorrect current password', async () => {
    await expect(service.changePassword(user.userId, {
      currentPassword: 'WrongRecovery@2026', newPassword: 'ChangedRecovery@2026', otp: '837492',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(otp.verifyOtp).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('does not reset on a wrong change-password OTP', async () => {
    otp.verifyOtp.mockRejectedValueOnce(new BadRequestException('Invalid OTP'));
    await expect(changePassword()).rejects.toBeInstanceOf(BadRequestException);
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('does not reset after password change session persistence fails', async () => {
    manager.save.mockRejectedValueOnce(new Error('session write failed'));
    await expect(changePassword()).rejects.toThrow('session write failed');
    expect(user.passwordHash).toBe(passwordHash);
    expect(user.tokenVersion).toBe(1);
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(events).toContain('rollback');
  });

  it('does not allow password change to clear a durable lock', async () => {
    user.isLocked = true;
    await expect(changePassword()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(user.isLocked).toBe(true);
  });

  it.each(['SMS', 'EMAIL'] as const)('%s password reset clears only Redis failure state after durable update', async (channel) => {
    state = { attempts: 5, tempTtl: 20, pendingManual: true };
    user.isLocked = true;

    const identifier = channel === 'EMAIL' ? 'email:recovery@example.invalid' : user.phoneNumber;
    await service.resetPassword(channel === 'EMAIL'
      ? { email: ' RECOVERY@EXAMPLE.INVALID ', newPassword: 'ResetRecovery@2026' } as any
      : { phoneNumber: user.phoneNumber, newPassword: 'ResetRecovery@2026' });
    expect(otp.consumePhoneVerified).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, identifier);
    expect(events).toEqual(['begin', 'update-password', 'increment-version', 'revoke:PASSWORD_RESET', 'commit', 'reset:PASSWORD_RESET']);
    expect(state).toEqual({ attempts: 0, tempTtl: 0, pendingManual: true });
    expect(user).toMatchObject({ isActive: true, isLocked: true });
    expect(lockout.resetLoginFailureState).toHaveBeenCalledWith(user.userId, 'PASSWORD_RESET');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('email password reset preserves a durable lock', async () => {
    user.isLocked = true;

    await service.resetPassword({ email: user.email!, newPassword: 'ResetRecovery@2026' } as any);
    expect(user).toMatchObject({
      isActive: true,
      isLocked: true,
    });
    expect(lockout.resetLoginFailureState).toHaveBeenCalledWith(user.userId, 'PASSWORD_RESET');
  });

  it('does not reset failures or update password when the RESET_PASSWORD marker was already used', async () => {
    otp.consumePhoneVerified.mockResolvedValueOnce(false);
    await expect(service.resetPassword({ phoneNumber: user.phoneNumber, newPassword: 'ResetRecovery@2026' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.updatePassword).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('does not reset failures after a password reset DB update fails', async () => {
    users.updatePassword.mockRejectedValueOnce(new Error('password write failed'));
    await expect(service.resetPassword({ phoneNumber: user.phoneNumber, newPassword: 'ResetRecovery@2026' })).rejects.toThrow('password write failed');
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
    expect(events).toContain('rollback');
    expect(user.passwordHash).toBe(passwordHash);
  });

  it('does not reactivate or reset failure state for an inactive account', async () => {
    user.isActive = false;
    await expect(service.resetPassword({ phoneNumber: user.phoneNumber, newPassword: 'ResetRecovery@2026' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.isActive).toBe(false);
    expect(otp.consumePhoneVerified).not.toHaveBeenCalled();
    expect(lockout.resetLoginFailureState).not.toHaveBeenCalled();
  });

  it('does not refresh an existing token while the user has a durable lock', async () => {
    user.isLocked = true;
    await expect(service.refreshToken('old-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessionRepository.findOne).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('checks lock state again inside the refresh transaction', async () => {
    state.pendingManual = true; state.attempts = 5;
    await expect(service.refreshToken('old-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
