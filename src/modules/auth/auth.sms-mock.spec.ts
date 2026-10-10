import { InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { OtpPurpose } from '../../common/redis/otp.constants.js';
import { AuthService } from './auth.service.js';

function createAuthService(existingUser: object | null, withOtpService = true) {
  const usersService = {
    findByPhoneNumber: vi.fn().mockResolvedValue(existingUser),
    findById: vi.fn().mockResolvedValue(existingUser),
  };
  const configService = {
    get: vi.fn((key: string) => {
      if (key === 'SMS_MODE') return 'mock';
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    }),
  };
  const otpService = withOtpService
    ? {
        createAndSaveOtp: vi.fn().mockResolvedValue({
          otp: '654321',
          otpHash: 'hash',
        }),
      }
    : undefined;
  const esmsService = { sendSMS: vi.fn().mockResolvedValue({ IsMock: true }) };

  const service = new AuthService(
    usersService as any,
    {} as any,
    configService as any,
    {} as any,
    {} as any,
    {} as any,
    esmsService as any,
    otpService as any,
    {} as any,
    { getState: vi.fn().mockResolvedValue({ pendingManual: false }) } as any,
  );

  return { service, otpService, esmsService };
}

describe('AuthService local SMS mock response', () => {
  it('delivers a random OTP through the mock transport without exposing it in the response', async () => {
    const { service, otpService, esmsService } = createAuthService({
      userId: 'user-1',
      isActive: true,
    });

    const result = await service.sendOtp({
      phoneNumber: '0908123456',
      purpose: OtpPurpose.RESET_PASSWORD,
    });

    expect(result).toEqual({
      message: 'Nếu số điện thoại hợp lệ, mã OTP đã được gửi',
      phoneNumber: '0908123456',
      expiresIn: '5 phút',
    });
    expect(otpService?.createAndSaveOtp).toHaveBeenCalledWith(
      OtpPurpose.RESET_PASSWORD,
      '0908123456',
    );
    expect(esmsService.sendSMS).toHaveBeenCalledWith('0908123456', '654321');
  });

  it('returns the same response shape without generating or exposing an OTP for an unknown account', async () => {
    const { service, otpService, esmsService } = createAuthService(null);

    const result = await service.sendOtp({
      phoneNumber: '0908999999',
      purpose: OtpPurpose.RESET_PASSWORD,
    });

    expect(result).toEqual({
      message: 'Nếu số điện thoại hợp lệ, mã OTP đã được gửi',
      phoneNumber: '0908999999',
      expiresIn: '5 phút',
    });
    expect(otpService?.createAndSaveOtp).not.toHaveBeenCalled();
    expect(esmsService.sendSMS).not.toHaveBeenCalled();
  });

  it('fails closed instead of using a fixed OTP when OtpService is unavailable', async () => {
    const { service } = createAuthService(
      { userId: 'user-1', isActive: true },
      false,
    );

    await expect(
      service.sendOtp({
        phoneNumber: '0908123456',
        purpose: OtpPurpose.RESET_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    await expect(
      service.verifyOtp({
        phoneNumber: '0908123456',
        otp: '123456',
        purpose: OtpPurpose.RESET_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    const passwordHash = await bcrypt.hash('CurrentPassword123!', 10);
    const { service: changePasswordService } = createAuthService(
      {
        userId: 'user-1',
        isActive: true,
        isLocked: false,
        phoneNumber: '0908123456',
        passwordHash,
      },
      false,
    );
    await expect(
      changePasswordService.changePassword('user-1', {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'NewPassword123!',
        otp: '123456',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe('AuthService Email mock response', () => {
  function createAuthServiceForEmail(existingUser: object | null) {
    const usersService = {
      findByNormalizedEmail: vi.fn().mockResolvedValue(existingUser),
      findByPhoneNumber: vi.fn(),
    };
    const otpService = {
      createAndSaveOtp: vi.fn().mockResolvedValue({
        otp: '111222',
        otpHash: 'hash',
      }),
    };
    const emailService = {
      sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      usersService as any,
      {} as any,
      { get: vi.fn() } as any,
      {} as any,
      {} as any,
      emailService as any,
      {} as any,
      otpService as any,
      {} as any,
    );

    return { service, otpService, emailService, usersService };
  }

  it('returns the real response and sends OTP for a known reset-password email', async () => {
    const { service, otpService, emailService } = createAuthServiceForEmail({
      userId: 'user-2',
      isActive: true,
    });

    const result = await service.forgotPassword(
      '',
      'test@EXAMPLE.COM '
    );

    expect(result).toEqual({
      message: 'Nếu email hợp lệ, mã OTP đã được gửi',
      email: 'test@example.com',
      expiresIn: '5 phút',
    });
    expect(otpService.createAndSaveOtp).toHaveBeenCalledWith(
      OtpPurpose.RESET_PASSWORD,
      'email:test@example.com',
    );
    expect(emailService.sendPasswordResetOtp).toHaveBeenCalledWith(
      'test@example.com',
      '111222',
    );
  });

  it('returns the same response shape but does NOT generate or send OTP for unknown email', async () => {
    const { service, otpService, emailService } = createAuthServiceForEmail(null);

    const result = await service.forgotPassword(
      '',
      'unknown@example.com'
    );

    expect(result).toEqual({
      message: 'Nếu email hợp lệ, mã OTP đã được gửi',
      email: 'unknown@example.com',
      expiresIn: '5 phút',
    });
    // REQUIREMENT: Email không tồn tại -> OTP generator không được gọi
    expect(otpService.createAndSaveOtp).not.toHaveBeenCalled();
    // REQUIREMENT: Email không tồn tại -> EmailService không được gọi
    expect(emailService.sendPasswordResetOtp).not.toHaveBeenCalled();
  });
});
