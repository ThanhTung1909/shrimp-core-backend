import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { OTP_CONFIG, OtpPurpose } from '../src/common/redis/otp.constants.js';
import { authLockoutFixture } from './helpers/auth-lockout-fixture.js';

const OTP = '482913';
const emailAddress = 'local-recovery@example.invalid';
const phoneNumber = '0999123456';

function fixture(environment: Record<string, string> = {}) {
  const configValues = { NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'false', ...environment };
  const config = { get: vi.fn((key: string) => configValues[key as keyof typeof configValues]) };
  const user = {
    userId: 'local-recovery-user',
    email: emailAddress,
    phoneNumber,
    isActive: true,
    isLocked: false,
    tokenVersion: 0,
  };
  const users = {
    findById: vi.fn().mockResolvedValue(user),
    findByNormalizedEmail: vi.fn().mockResolvedValue(user),
    findByPhoneNumber: vi.fn().mockResolvedValue(user),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  };
  const manager = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
  const dataSource = { transaction: vi.fn(async (callback) => callback(manager)) };
  const otp = {
    createAndSaveOtp: vi.fn().mockResolvedValue({ otp: OTP, otpHash: 'stored-hash' }),
    verifyOtp: vi.fn().mockResolvedValue(true),
    consumePhoneVerified: vi.fn().mockResolvedValue(true),
  };
  const email = { sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) };
  const sms = { sendSMS: vi.fn().mockResolvedValue(undefined) };
  const lockout = authLockoutFixture(users, dataSource);
  const service = new AuthService(
    users as any,
    {} as any,
    config as any,
    {} as any,
    dataSource as any,
    email as any,
    sms as any,
    otp as any,
    undefined,
    lockout as any,
  );
  return { service, users, manager, otp, email, sms, lockout, config };
}

function captureRecoveryLogs(service: AuthService) {
  const logger = { log: vi.fn(), error: vi.fn() };
  (service as any).logger = logger;
  return logger;
}

function expectLocalOtpLog(
  logger: { log: ReturnType<typeof vi.fn> },
  purpose: OtpPurpose,
  channel: 'email' | 'sms',
) {
  expect(logger.log.mock.calls).toEqual([
    [`[AuthOTP][LOCAL-TEST-ONLY] Purpose: ${purpose}`],
    [`[AuthOTP][LOCAL-TEST-ONLY] Channel: ${channel}`],
    [`[AuthOTP][LOCAL-TEST-ONLY] OTP: ${OTP}`],
    [`[AuthOTP][LOCAL-TEST-ONLY] Redis TTL: ${OTP_CONFIG.TTL_SECONDS}s`],
  ]);
}

function expectNoRawOtpLog(logger: { log: ReturnType<typeof vi.fn> }) {
  expect(JSON.stringify(logger.log.mock.calls)).not.toContain(OTP);
}

describe('local-only OTP console and delivery contract', () => {
  it('logs a persisted email RESET_PASSWORD OTP on SMTP success and preserves reset validation', async () => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);

    const response = await f.service.forgotPassword(undefined, emailAddress);

    expect(response).not.toHaveProperty('otp');
    expect(f.otp.createAndSaveOtp).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, `email:${emailAddress}`);
    expect(f.email.sendPasswordResetOtp).toHaveBeenCalledWith(emailAddress, OTP);
    expectLocalOtpLog(logger, OtpPurpose.RESET_PASSWORD, 'email');
    expect(logger.error).not.toHaveBeenCalled();

    await f.service.verifyOtp({ email: emailAddress, otp: OTP, purpose: OtpPurpose.RESET_PASSWORD } as any);
    await f.service.resetPassword({ email: emailAddress, newPassword: 'ResetLocalOnly@2026!' } as any);
    expect(f.otp.consumePhoneVerified).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, `email:${emailAddress}`);
    expect(f.users.updatePassword).toHaveBeenCalledOnce();
    expect(f.manager.update).toHaveBeenCalledOnce();
  });

  it('logs a persisted email OTP before an SMTP failure and returns a safe 503', async () => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);
    f.email.sendPasswordResetOtp.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(f.service.forgotPassword(undefined, emailAddress)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        error: 'OTP_DELIVERY_UNAVAILABLE',
        data: { channel: 'email', otpStored: true, expiresIn: '5 phút' },
      }),
    });
    expectLocalOtpLog(logger, OtpPurpose.RESET_PASSWORD, 'email');
    expect(logger.error).toHaveBeenCalledWith('[AuthOTP] SMTP delivery failed');
  });

  it('logs a persisted SMS OTP on eSMS success and does not include it in the response', async () => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);

    const response = await f.service.forgotPassword(phoneNumber);

    expect(response).not.toHaveProperty('otp');
    expect(f.sms.sendSMS).toHaveBeenCalledWith(phoneNumber, OTP);
    expectLocalOtpLog(logger, OtpPurpose.RESET_PASSWORD, 'sms');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a persisted SMS OTP before an eSMS failure and returns a safe 503', async () => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);
    f.sms.sendSMS.mockRejectedValueOnce(new Error('eSMS unavailable'));

    await expect(f.service.forgotPassword(phoneNumber)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ data: { channel: 'sms', otpStored: true, expiresIn: '5 phút' } }),
    });
    expectLocalOtpLog(logger, OtpPurpose.RESET_PASSWORD, 'sms');
    expect(logger.error).toHaveBeenCalledWith('[AuthOTP] eSMS delivery failed');
  });

  it('logs a persisted OTP before a provider timeout and returns 503', async () => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true', AUTH_OTP_DELIVERY_TIMEOUT_MS: '1000' });
    const logger = captureRecoveryLogs(f.service);
    f.email.sendPasswordResetOtp.mockReturnValueOnce(new Promise<void>(() => {}));

    await expect(f.service.forgotPassword(undefined, emailAddress)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expectLocalOtpLog(logger, OtpPurpose.RESET_PASSWORD, 'email');
    expect(logger.error).toHaveBeenCalledWith('[AuthOTP] SMTP delivery failed');
  });

  it.each([
    ['production', 'true'],
    ['development', 'false'],
    ['test', 'true'],
  ])('never logs raw OTP outside the enabled local condition (%s, %s)', async (nodeEnv, fallback) => {
    const f = fixture({ NODE_ENV: nodeEnv, AUTH_OTP_CONSOLE_FALLBACK: fallback });
    const logger = captureRecoveryLogs(f.service);

    await f.service.forgotPassword(undefined, emailAddress);

    expectNoRawOtpLog(logger);
  });

  it('does not log or deliver an OTP when Redis persistence fails', async () => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);
    f.otp.createAndSaveOtp.mockRejectedValueOnce(new InternalServerErrorException('Redis unavailable'));

    await expect(f.service.forgotPassword(undefined, emailAddress)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(f.email.sendPasswordResetOtp).not.toHaveBeenCalled();
    expectNoRawOtpLog(logger);
  });

  it.each([
    [OtpPurpose.REGISTER, '0999123001'],
    [OtpPurpose.LOGIN, phoneNumber],
    [OtpPurpose.CHANGE_PASSWORD, phoneNumber],
  ])('uses the same local console rule for %s', async (purpose, subject) => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);
    if (purpose === OtpPurpose.REGISTER) f.users.findByPhoneNumber.mockResolvedValueOnce(null);

    const response = await f.service.sendOtp({ purpose, phoneNumber: subject } as any);

    expect(response).not.toHaveProperty('otp');
    expectLocalOtpLog(logger, purpose, 'sms');
  });

  it.each([
    ['email', (f: ReturnType<typeof fixture>) => f.service.forgotPassword(undefined, emailAddress)],
    ['phone', (f: ReturnType<typeof fixture>) => f.service.forgotPassword(phoneNumber)],
  ])('returns 404 without creating, delivering, or logging OTP for an unknown %s account', async (_channel, request) => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);
    f.users.findByNormalizedEmail.mockResolvedValueOnce(null);
    f.users.findByPhoneNumber.mockResolvedValueOnce(null);

    await expect(request(f)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.otp.createAndSaveOtp).not.toHaveBeenCalled();
    expect(f.email.sendPasswordResetOtp).not.toHaveBeenCalled();
    expect(f.sms.sendSMS).not.toHaveBeenCalled();
    expectNoRawOtpLog(logger);
  });

  it.each([
    ['email', (f: ReturnType<typeof fixture>) => f.service.forgotPassword(undefined, emailAddress)],
    ['phone', (f: ReturnType<typeof fixture>) => f.service.forgotPassword(phoneNumber)],
  ])('rejects an inactive %s account before creating, delivering, or logging OTP', async (_channel, request) => {
    const f = fixture({ NODE_ENV: 'development', AUTH_OTP_CONSOLE_FALLBACK: 'true' });
    const logger = captureRecoveryLogs(f.service);
    f.users.findByNormalizedEmail.mockResolvedValueOnce({ isActive: false });
    f.users.findByPhoneNumber.mockResolvedValueOnce({ isActive: false });

    await expect(request(f)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.otp.createAndSaveOtp).not.toHaveBeenCalled();
    expect(f.email.sendPasswordResetOtp).not.toHaveBeenCalled();
    expect(f.sms.sendSMS).not.toHaveBeenCalled();
    expectNoRawOtpLog(logger);
  });
});
