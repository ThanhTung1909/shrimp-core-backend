import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserSession } from '../src/modules/auth/entities/user-session.entity';
import { DataSource } from 'typeorm';
import { EmailService } from '../src/modules/email/email.service';
import { EsmsService } from '../src/common/esms/esms.service';
import { OtpPurpose } from '../src/common/redis/otp.constants.js';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('bcrypt', () => ({
  compare: vi.fn(),
  hash: vi.fn().mockResolvedValue('newHash'),
}));

describe('BE-022 Authentication Tests', () => {
  let authService: AuthService;
  let otpService: any;
  let usersService: any;
  let dataSource: any;
  let mockManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockManager = {
      update: vi.fn(),
      create: vi.fn().mockReturnValue({}),
      save: vi.fn(),
    };

    dataSource = {
      transaction: vi.fn().mockImplementation(async (cb) => cb(mockManager)),
    };

    otpService = {
      createAndSaveOtp: vi.fn(),
      verifyOtp: vi.fn(),
      consumePhoneVerified: vi.fn(),
    };

    usersService = {
      findByPhoneNumber: vi.fn(),
      findById: vi.fn(),
      updatePassword: vi.fn(),
      incrementTokenVersion: vi.fn().mockResolvedValue(2),
      setLoginLocked: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: OtpService, useValue: otpService },
        { provide: JwtService, useValue: { signAsync: vi.fn().mockResolvedValue('dummy-token'), decode: vi.fn().mockReturnValue({ exp: 123456789 }) } },
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: getRepositoryToken(UserSession), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: EmailService, useValue: {} },
        { provide: EsmsService, useValue: { sendSMS: vi.fn() } },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  describe('RESET_PASSWORD flow', () => {
    it('should reject reset password if user not found', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null);
      await expect(
        authService.resetPassword({ phoneNumber: '0901234567', newPassword: 'Password123' })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject reset password if OTP verification marker is invalid or expired', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: '1', isActive: true });
      otpService.consumePhoneVerified.mockResolvedValue(false);

      await expect(
        authService.resetPassword({ phoneNumber: '0901234567', newPassword: 'Password123' })
      ).rejects.toThrow(UnauthorizedException);
      expect(otpService.consumePhoneVerified).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, '0901234567');
    });

    it('should successfully reset password, increment tokenVersion and revoke old sessions', async () => {
      usersService.findByPhoneNumber.mockResolvedValue({ userId: 'u1', isActive: true });
      otpService.consumePhoneVerified.mockResolvedValue(true);

      const res = await authService.resetPassword({ phoneNumber: '0901234567', newPassword: 'Password123' });

      expect(res.message).toContain('thành công');
      expect(usersService.updatePassword).toHaveBeenCalled();
      expect(usersService.incrementTokenVersion).toHaveBeenCalledWith('u1', mockManager);
      expect(mockManager.update).toHaveBeenCalledWith(
        UserSession,
        expect.any(Object),
        expect.objectContaining({ revokeReason: 'PASSWORD_RESET' })
      );
    });

    it('should not leak user existence on send-otp for RESET_PASSWORD', async () => {
      usersService.findByPhoneNumber.mockResolvedValue(null); // User not found

      const res = await authService.sendOtp({ phoneNumber: '0901234567', purpose: OtpPurpose.RESET_PASSWORD });
      expect(res.message).toContain('Nếu số điện thoại hợp lệ, mã OTP đã được gửi');
      expect(otpService.createAndSaveOtp).not.toHaveBeenCalled(); // Ensure SMS isn't sent
    });
  });

  describe('CHANGE_PASSWORD flow', () => {
    it('should reject change password if current password is wrong', async () => {
      usersService.findById.mockResolvedValue({ userId: 'u1', isActive: true, passwordHash: 'hash' });
      (bcrypt.compare as any).mockResolvedValue(false);

      await expect(
        authService.changePassword('u1', { currentPassword: 'wrong', newPassword: 'Password123', otp: '123456' })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject change password if OTP is wrong', async () => {
      usersService.findById.mockResolvedValue({ userId: 'u1', isActive: true, passwordHash: 'hash', phoneNumber: '090' });
      (bcrypt.compare as any).mockResolvedValue(true);
      otpService.verifyOtp.mockRejectedValue(new BadRequestException('Mã OTP sai'));

      await expect(
        authService.changePassword('u1', { currentPassword: 'right', newPassword: 'Password123', otp: 'wrong' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed change password if valid', async () => {
      usersService.findById.mockResolvedValue({ userId: 'u1', isActive: true, passwordHash: 'hash', phoneNumber: '090' });
      (bcrypt.compare as any).mockResolvedValue(true);
      otpService.verifyOtp.mockResolvedValue(true);

      await authService.changePassword('u1', { currentPassword: 'right', newPassword: 'Password123', otp: '123456' });

      expect(otpService.verifyOtp).toHaveBeenCalledWith(OtpPurpose.CHANGE_PASSWORD, '090', '123456');
      expect(usersService.updatePassword).toHaveBeenCalled();
      expect(mockManager.update).toHaveBeenCalledWith(
        UserSession,
        expect.any(Object),
        expect.objectContaining({ revokeReason: 'PASSWORD_CHANGED' })
      );
    });
  });
});
