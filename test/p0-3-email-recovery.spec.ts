import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../src/common/redis/redis.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import { getEmailOtpIdentifier, getOtpCodeKey, getOtpVerifiedKey, OtpPurpose } from '../src/common/redis/otp.constants.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { ForgotPasswordDto } from '../src/modules/auth/dto/forgot-password.dto.js';
import { VerifyOtpDto } from '../src/modules/auth/dto/verify-otp.dto.js';
import { ResetPasswordDto } from '../src/modules/auth/dto/reset-password.dto.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { authLockoutFixture } from './helpers/auth-lockout-fixture.js';

const dtos = [ForgotPasswordDto, VerifyOtpDto, ResetPasswordDto];
const extra = { otp: '654321', purpose: OtpPurpose.RESET_PASSWORD, newPassword: 'SecureNew@2026!' };

describe('Email recovery contract', () => {
  for (const Dto of dtos) {
    it(`${Dto.name} accepts exactly one normalized email or phone`, async () => {
      const email = plainToInstance(Dto, { ...extra, email: ' MANAGER@EXAMPLE.COM ' });
      expect(email.email).toBe('manager@example.com');
      expect(await validate(email)).toHaveLength(0);
      expect(await validate(plainToInstance(Dto, { ...extra, phoneNumber: '0908123456' }))).toHaveLength(0);
      for (const identity of [{}, { email: null }, { email: 'broken' }, { email: 'a@example.com', phoneNumber: '0908123456' }]) {
        expect((await validate(plainToInstance(Dto, { ...extra, ...identity }))).length).toBeGreaterThan(0);
      }
    });
  }

  it('keeps email-only requests valid with the production ValidationPipe settings', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    const result = await pipe.transform({ email: ' A@EXAMPLE.COM ' }, { type: 'body', metatype: ForgotPasswordDto });
    expect(result.email).toBe('a@example.com');
    await expect(pipe.transform({}, { type: 'body', metatype: ForgotPasswordDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});

function fixture(user: any = { userId: 'email-user', email: 'a@example.com', phoneNumber: '0908123456', isActive: true }, withOtp = true) {
  const users = { findById: vi.fn().mockResolvedValue(user), findByNormalizedEmail: vi.fn().mockResolvedValue(user), findByPhoneNumber: vi.fn().mockResolvedValue(user), updatePassword: vi.fn(), incrementTokenVersion: vi.fn() };
  const email = { sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) };
  const otp = { createAndSaveOtp: vi.fn().mockResolvedValue({ otp: '654321' }), verifyOtp: vi.fn().mockResolvedValue(true), consumePhoneVerified: vi.fn().mockResolvedValue(true) };
  const manager = { update: vi.fn() };
  const dataSource = { transaction: vi.fn(async (callback) => callback(manager)) };
  const service = new AuthService(users as any, {} as any, new ConfigService({ NODE_ENV: 'production', SMS_MODE: 'esms' }), {} as any, dataSource as any, email as any, {} as any, withOtp ? otp as any : undefined, undefined, authLockoutFixture(users, dataSource) as any);
  return { service, users, email, otp, dataSource, manager };
}

describe('Email recovery service security', () => {
  it('reuses EmailService and separates email from SMS keys without exposing OTP', async () => {
    const f = fixture();
    const result = await f.service.forgotPassword(undefined as any, ' MANAGER@EXAMPLE.COM ');
    expect(result).not.toHaveProperty('otp');
    expect(f.users.findByNormalizedEmail).toHaveBeenCalledWith('manager@example.com');
    expect(f.otp.createAndSaveOtp).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, 'email:manager@example.com');
    expect(f.email.sendPasswordResetOtp).toHaveBeenCalledWith('manager@example.com', '654321');
  });

  it('returns explicit account and provider errors without creating an OTP for an ineligible email account', async () => {
    const known = fixture();
    const unknown = fixture(null);
    const inactive = fixture({ isActive: false });
    const failed = fixture();
    failed.email.sendPasswordResetOtp.mockRejectedValueOnce(new Error('provider error'));

    await expect(known.service.forgotPassword(undefined as any, 'a@example.com')).resolves.not.toHaveProperty('otp');
    await expect(unknown.service.forgotPassword(undefined as any, 'a@example.com')).rejects.toBeInstanceOf(NotFoundException);
    await expect(inactive.service.forgotPassword(undefined as any, 'a@example.com')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(failed.service.forgotPassword(undefined as any, 'a@example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(unknown.otp.createAndSaveOtp).not.toHaveBeenCalled();
    expect(inactive.email.sendPasswordResetOtp).not.toHaveBeenCalled();
    expect(failed.otp.createAndSaveOtp).toHaveBeenCalledOnce();
  });

  it('waits for SMTP delivery before returning a successful response', async () => {
    const f = fixture();
    let resolveDelivery!: () => void;
    f.email.sendPasswordResetOtp.mockReturnValueOnce(new Promise<void>((resolve) => { resolveDelivery = resolve; }));
    const request = f.service.forgotPassword(undefined as any, 'a@example.com');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(f.email.sendPasswordResetOtp).toHaveBeenCalledOnce();
    resolveDelivery();
    await expect(request).resolves.not.toHaveProperty('otp');
  });

  it('accepts only RESET_PASSWORD purpose for email', async () => {
    const f = fixture();
    await expect(f.service.verifyOtp({ email: 'a@example.com', otp: '654321', purpose: OtpPurpose.LOGIN } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.otp.verifyOtp).not.toHaveBeenCalled();
    const result = await f.service.verifyOtp({ email: ' A@EXAMPLE.COM ', otp: '654321', purpose: OtpPurpose.RESET_PASSWORD } as any);
    expect(f.otp.verifyOtp).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, 'email:a@example.com', '654321');
    expect(result).toEqual({ message: 'Xác thực OTP thành công!', email: 'a@example.com', isValid: true });
  });

  it('consumes email marker and reuses password update/session revocation transaction', async () => {
    const f = fixture();
    await f.service.resetPassword({ email: ' A@EXAMPLE.COM ', newPassword: 'SecureNew@2026!' } as any);
    expect(f.otp.consumePhoneVerified).toHaveBeenCalledWith(OtpPurpose.RESET_PASSWORD, 'email:a@example.com');
    expect(f.users.updatePassword).toHaveBeenCalledWith('email-user', expect.stringMatching(/^\$2/), f.manager);
    expect(f.users.incrementTokenVersion).toHaveBeenCalledWith('email-user', f.manager);
    expect(f.manager.update).toHaveBeenCalled();
    f.otp.consumePhoneVerified.mockResolvedValueOnce(false);
    await expect(f.service.resetPassword({ email: 'a@example.com', newPassword: 'SecureNew@2026!' } as any)).rejects.toThrow('Chưa xác thực OTP');
    // Failed marker validation is now inside the serialized transaction.
    expect(f.dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(f.users.updatePassword).toHaveBeenCalledTimes(1);
  });

  it('fails closed without OtpService during reset', async () => {
    const f = fixture(undefined, false);
    await expect(f.service.resetPassword({ email: 'a@example.com', newPassword: 'SecureNew@2026!' } as any)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(f.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not enumerate email accounts through reset error messages', async () => {
    const known = fixture();
    known.otp.consumePhoneVerified.mockResolvedValueOnce(false);
    const unknown = fixture(null);
    const payload = { email: 'a@example.com', newPassword: 'SecureNew@2026!' } as any;
    const errors = await Promise.all([known, unknown].map(async f => {
      try { await f.service.resetPassword(payload); }
      catch (error: any) { return { status: error.getStatus(), message: error.message }; }
    }));
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[0]?.status).toBe(401);
  });

  it('uses separate normalized email rate limits and the existing IP limit', async () => {
    const f = fixture();
    const rate = { checkLimit: vi.fn().mockResolvedValue({ allowed: true }) };
    const controller = new AuthController(f.service, f.users as any, rate as any);
    await controller.forgotPassword({ email: ' A@EXAMPLE.COM ' } as any, '127.0.0.2');
    await controller.verifyOtp({ email: ' A@EXAMPLE.COM ', otp: '654321', purpose: OtpPurpose.RESET_PASSWORD } as any);
    expect(rate.checkLimit.mock.calls).toEqual([
      ['rl:otp:send:email:a@example.com', 1, 60],
      ['rl:otp:send:ip:127.0.0.2', 5, 600],
      ['rl:otp:verify:email:a@example.com', 5, 300],
    ]);
  });

  it('fails closed on ambiguous case-insensitive legacy email records', async () => {
    const query = { where: vi.fn().mockReturnThis(), take: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([{ userId: '1' }, { userId: '2' }]) };
    const users = new UsersService({ createQueryBuilder: vi.fn().mockReturnValue(query) } as any);
    expect(await users.findByNormalizedEmail(' A@EXAMPLE.COM ')).toBeNull();
    expect(query.where).toHaveBeenCalledWith('LOWER(TRIM(user.email)) = :email', { email: 'a@example.com' });
  });
});

describe('Email OTP with real Redis', () => {
  let redis: RedisService;
  let otp: OtpService;
  const purpose = OtpPurpose.RESET_PASSWORD;
  const next = () => getEmailOtpIdentifier(`p03-${randomUUID()}@example.com`);
  beforeAll(async () => {
    redis = new RedisService(new ConfigService({ REDIS_PORT: process.env.REDIS_PORT || 6390 }));
    await redis.onModuleInit();
    otp = new OtpService(redis);
  });
  afterAll(async () => { await redis.onModuleDestroy(); });

  it('stores hashes with TTL, counts wrong attempts, isolates channel/purpose, and consumes once', async () => {
    const identity = next();
    const code = await otp.createAndSaveOtp(purpose, identity);
    expect(await otp.getOtpCodeHash(purpose, identity)).toBe(code.otpHash);
    expect(await redis.getClient().ttl(getOtpCodeKey(purpose, identity))).toBeGreaterThanOrEqual(299);
    const wrong = code.otp === '100000' ? '100001' : '100000';
    await expect(otp.verifyOtp(purpose, identity, wrong)).rejects.toThrow();
    expect(await otp.getOtpAttempts(purpose, identity)).toBe(1);
    await expect(otp.verifyOtp(OtpPurpose.REGISTER, identity, code.otp)).rejects.toThrow();
    await expect(otp.verifyOtp(purpose, '0908123456', code.otp)).rejects.toThrow();
    expect(await otp.verifyOtp(purpose, identity, code.otp)).toBe(true);
    expect(await otp.getOtpCodeHash(purpose, identity)).toBeNull();
    expect(await redis.getClient().ttl(getOtpVerifiedKey(purpose, identity))).toBeGreaterThanOrEqual(599);
    await expect(otp.verifyOtp(purpose, identity, code.otp)).rejects.toThrow();
    expect(await otp.consumePhoneVerified(purpose, identity)).toBe(true);
    expect(await otp.consumePhoneVerified(purpose, identity)).toBe(false);
  });

  it('rejects expired OTP and destroys code after five wrong attempts', async () => {
    const expired = next();
    const { otp: code } = await otp.createAndSaveOtp(purpose, expired, 1);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await expect(otp.verifyOtp(purpose, expired, code)).rejects.toThrow();
    const identity = next();
    const created = await otp.createAndSaveOtp(purpose, identity);
    const wrong = created.otp === '100000' ? '100001' : '100000';
    for (let i = 0; i < 5; i++) await expect(otp.verifyOtp(purpose, identity, wrong)).rejects.toThrow();
    expect(await otp.getOtpCodeHash(purpose, identity)).toBeNull();
    await expect(otp.verifyOtp(purpose, identity, created.otp)).rejects.toThrow();
  });
});
