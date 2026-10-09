import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { OtpService } from '../src/common/redis/otp.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserSession } from '../src/modules/auth/entities/user-session.entity';
import { DataSource } from 'typeorm';
import { EmailService } from '../src/modules/email/email.service';
import { EsmsService } from '../src/common/esms/esms.service';
import { LoginSecurityService } from '../src/common/redis/login-security.service';
import { OtpPurpose } from '../src/common/redis/otp.constants.js';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Role } from '../src/common/enums/role.enum';

vi.mock('bcrypt', () => ({
  compare: vi.fn(),
  hash: vi.fn().mockResolvedValue('newHash'),
}));

describe('Auth Password Protection', () => {
  let authService: AuthService;
  let usersService: any;
  let loginSecurityService: any;
  let otpService: any;
  let dataSource: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    usersService = {
      findByPhoneNumber: vi.fn(),
      findByEmail: vi.fn(),
      findById: vi.fn(),
      setLoginLocked: vi.fn(),
      updatePassword: vi.fn(),
      incrementTokenVersion: vi.fn(),
      update: vi.fn(),
    };

    loginSecurityService = {
      getTemporaryLockTtl: vi.fn().mockResolvedValue(-2),
      recordFailure: vi.fn().mockResolvedValue(1),
      createTemporaryLock: vi.fn(),
      clear: vi.fn(),
    };

    otpService = {
      createAndSaveOtp: vi.fn().mockResolvedValue({ otp: '123456' }),
      verifyOtp: vi.fn(),
      consumePhoneVerified: vi.fn().mockResolvedValue(true),
    };

    dataSource = {
      transaction: vi.fn().mockImplementation(async (cb) => cb(usersService)), // Just a dummy manager
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: { signAsync: vi.fn().mockResolvedValue('token'), decode: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }) } },
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: getRepositoryToken(UserSession), useValue: { create: vi.fn().mockReturnValue({}), save: vi.fn() } },
        { provide: DataSource, useValue: dataSource },
        { provide: EmailService, useValue: { sendOtpEmail: vi.fn() } },
        { provide: EsmsService, useValue: { sendSMS: vi.fn() } },
        { provide: OtpService, useValue: otpService },
        { provide: LoginSecurityService, useValue: loginSecurityService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('login()', () => {
    it('unknown account: should use DUMMY_HASH, not touch LoginSecurityService', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(
        authService.login({ phoneNumber: '000', password: 'abc' })
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(bcrypt.compare).toHaveBeenCalled();
      expect(loginSecurityService.getTemporaryLockTtl).not.toHaveBeenCalled();
      expect(loginSecurityService.recordFailure).not.toHaveBeenCalled();
      expect(loginSecurityService.createTemporaryLock).not.toHaveBeenCalled();
    });

    it('existing user, isLoginLocked=true: reject immediately before bcrypt', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: true });

      await expect(
        authService.login({ phoneNumber: '000', password: 'abc' })
      ).rejects.toMatchObject({ response: { code: 'LOGIN_PERMANENTLY_LOCKED' } });

      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('existing user, lockTtl > 0: reject before bcrypt', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(10);

      await expect(
        authService.login({ phoneNumber: '000', password: 'abc' })
      ).rejects.toMatchObject({ response: { code: 'LOGIN_TEMPORARILY_LOCKED' } });

      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('wrong password: recordFailure atomic, attempts=3 -> 30s lock', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false, passwordHash: 'hash' });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(-2);
      (bcrypt.compare as any).mockResolvedValue(false);
      loginSecurityService.recordFailure.mockResolvedValue(3);

      await expect(
        authService.login({ phoneNumber: '000', password: 'abc' })
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(loginSecurityService.recordFailure).toHaveBeenCalledWith('u1');
      expect(loginSecurityService.createTemporaryLock).toHaveBeenCalledWith('u1', 30);
    });

    it('wrong password: attempts=5 -> 60s lock', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false, passwordHash: 'hash' });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(-2);
      (bcrypt.compare as any).mockResolvedValue(false);
      loginSecurityService.recordFailure.mockResolvedValue(5);

      await expect(authService.login({ phoneNumber: '000', password: 'abc' })).rejects.toThrow();
      expect(loginSecurityService.createTemporaryLock).toHaveBeenCalledWith('u1', 60);
    });

    it('wrong password: attempts=10 -> permanent lock', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false, passwordHash: 'hash' });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(-2);
      (bcrypt.compare as any).mockResolvedValue(false);
      loginSecurityService.recordFailure.mockResolvedValue(10);

      await expect(authService.login({ phoneNumber: '000', password: 'abc' })).rejects.toThrow();
      expect(usersService.setLoginLocked).toHaveBeenCalledWith('u1', true);
      expect(loginSecurityService.clear).toHaveBeenCalledWith('u1');
    });

    it('wrong password: other attempts -> no lock', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false, passwordHash: 'hash' });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(-2);
      (bcrypt.compare as any).mockResolvedValue(false);
      loginSecurityService.recordFailure.mockResolvedValue(4);

      await expect(authService.login({ phoneNumber: '000', password: 'abc' })).rejects.toThrow();
      expect(loginSecurityService.createTemporaryLock).not.toHaveBeenCalled();
      expect(usersService.setLoginLocked).not.toHaveBeenCalled();
    });

    it('successful login: clear security', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false, isActive: true, passwordHash: 'hash' });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(-2);
      (bcrypt.compare as any).mockResolvedValue(true);

      await authService.login({ phoneNumber: '000', password: 'abc' });
      expect(loginSecurityService.clear).toHaveBeenCalledWith('u1');
    });
  });

  describe('OTP functions', () => {
    it('sendOtp LOGIN: hides permanent lock state and does not send OTP', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: true });

      const result = await authService.sendOtp({
        phoneNumber: '000',
        purpose: OtpPurpose.LOGIN,
      });

      expect(result).toEqual({
        message: 'Nếu số điện thoại hợp lệ, mã OTP đã được gửi',
        phoneNumber: '000',
        expiresIn: '5 phút',
      });
      expect(otpService.createAndSaveOtp).not.toHaveBeenCalled();
    });

    it('verifyOtp LOGIN: clear security on success', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: false, isActive: true });
      loginSecurityService.getTemporaryLockTtl.mockResolvedValue(-2);
      
      await authService.verifyOtp({ phoneNumber: '000', otp: '123456', purpose: OtpPurpose.LOGIN });
      expect(loginSecurityService.clear).toHaveBeenCalledWith('u1');
    });
    
    it('resetPassword: clear security on success', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isLoginLocked: true, isActive: true });
      await authService.resetPassword({ phoneNumber: '000', otp: '123456', newPassword: 'abc' });
      
      expect(usersService.setLoginLocked).toHaveBeenCalledWith('u1', false, usersService);
      expect(loginSecurityService.clear).toHaveBeenCalledWith('u1');
    });
  });
});
