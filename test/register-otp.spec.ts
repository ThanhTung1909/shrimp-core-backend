import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RedisService } from '../src/common/redis/redis.service.js';
import { OtpService } from '../src/common/redis/otp.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { getOtpVerifiedKey } from '../src/common/redis/otp.constants.js';
import { Role } from '../src/common/enums/role.enum.js';
import { JwtService } from '@nestjs/jwt';

describe('REGISTER OTP VERIFICATION INTEGRATION SUITE', () => {
  let redisService: RedisService;
  let otpService: OtpService;
  let authService: AuthService;
  let usersService: any;
  let jwtService: JwtService;
  let configService: ConfigService;

  const testId = Date.now();
  let phoneSeq = 2000;
  const getNextPhone = () => `096${testId.toString().slice(-4)}${(phoneSeq++).toString().padStart(4, '0')}`;

  beforeAll(async () => {
    configService = new ConfigService({
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_DB: 0,
      JWT_ACCESS_SECRET: 'test_jwt_access_secret_key_1234567890123456',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_key_1234567890123456',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    redisService = new RedisService(configService);
    await redisService.onModuleInit();
    otpService = new OtpService(redisService);
    jwtService = new JwtService({ secret: 'test_jwt_access_secret_key_1234567890123456' });
  });

  afterAll(async () => {
    const client = redisService.getClient();
    if (client && client.status === 'ready') {
      const keys = await client.keys('otp:*:096*');
      if (keys.length > 0) {
        await redisService.del(...keys);
      }
    }
    await redisService.onModuleDestroy();
  });

  beforeEach(() => {
    const usersDb = new Map<string, any>();

    usersService = {
      findByPhoneNumber: vi.fn(async (phone: string) => usersDb.get(phone) || null),
      createUser: vi.fn(async (data: any) => {
        const user = {
          userId: 'user-' + Math.random(),
          tokenVersion: 0,
          role: data.role || Role.FARMER,
          ...data,
        };
        usersDb.set(data.phoneNumber, user);
        return user;
      }),
    };

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      {} as any,
      {} as any,
      otpService,
    );
  });

  it('Test 1 — Register không verify OTP -> Bị từ chối và User không được tạo', async () => {
    const phone = getNextPhone();
    const registerDto = {
      fullName: 'No OTP User',
      phoneNumber: phone,
      password: 'Password123!',
    };

    await expect(authService.register(registerDto)).rejects.toThrow(BadRequestException);
    await expect(authService.register(registerDto)).rejects.toThrow('Vui lòng xác thực OTP trước khi đăng ký!');

    // Đảm bảo User không được tạo
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it('Test 2 — Verification marker hết hạn -> Register bị từ chối', async () => {
    const phone = getNextPhone();

    // Tạo verified marker với TTL 1s
    await otpService.setPhoneVerified(phone, 1);
    expect(await otpService.isPhoneVerified(phone)).toBe(true);

    // Chờ 1.1s cho marker hết hạn
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await otpService.isPhoneVerified(phone)).toBe(false);

    const registerDto = {
      fullName: 'Expired OTP User',
      phoneNumber: phone,
      password: 'Password123!',
    };

    await expect(authService.register(registerDto)).rejects.toThrow(BadRequestException);
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it('Test 3 & 4 — Flow đầy đủ: send -> verify -> register -> marker bị consume (one-time)', async () => {
    const phone = getNextPhone();

    // 1. Send OTP
    const { otp } = await otpService.createAndSaveOtp(phone);

    // 2. Verify OTP thành công -> Tạo marker otp:verified:<phone>
    const verifyOk = await otpService.verifyOtp(phone, otp);
    expect(verifyOk).toBe(true);
    expect(await otpService.isPhoneVerified(phone)).toBe(true);

    // 3. Register
    const res = await authService.register({
      fullName: 'Nguyen Van A',
      phoneNumber: phone,
      password: 'Password123!',
    });

    expect(res).toBeDefined();
    expect(res.message).toBe('Đăng ký tài khoản thành công!');
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
    expect(res.role).toBe(Role.FARMER);
    expect(usersService.createUser).toHaveBeenCalledTimes(1);

    // 4. Test 4: Marker bị consume -> không còn tồn tại trong Redis
    expect(await otpService.isPhoneVerified(phone)).toBe(false);
    expect(await redisService.exists(getOtpVerifiedKey(phone))).toBe(0);
  });

  it('Test 5 — Không thể register lần 2 bằng cùng một verification', async () => {
    const phone = getNextPhone();

    // Verify OTP
    const { otp } = await otpService.createAndSaveOtp(phone);
    await otpService.verifyOtp(phone, otp);

    // Lần 1: Thành công
    const firstRes = await authService.register({
      fullName: 'User Once',
      phoneNumber: phone,
      password: 'Password123!',
    });
    expect(firstRes).toBeDefined();

    // Lần 2: Bị từ chối vì số điện thoại đã tồn tại và marker đã bị xóa
    await expect(
      authService.register({
        fullName: 'User Twice',
        phoneNumber: phone,
        password: 'Password123!',
      }),
    ).rejects.toThrow();
  });

  it('Test 6 — Concurrent register: chỉ 1 request consume marker thành công', async () => {
    const phone = getNextPhone();

    // Tạo verified marker
    await otpService.setPhoneVerified(phone, 600);
    expect(await otpService.isPhoneVerified(phone)).toBe(true);

    // Gửi 2 request register đồng thời cho cùng 1 số điện thoại
    const results = await Promise.allSettled([
      authService.register({
        fullName: 'User Concurrent 1',
        phoneNumber: phone,
        password: 'Password123!',
      }),
      authService.register({
        fullName: 'User Concurrent 2',
        phoneNumber: phone,
        password: 'Password123!',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Chính xác 1 request thành công và 1 request bị từ chối
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // User chỉ được tạo duy nhất 1 lần
    expect(usersService.createUser).toHaveBeenCalledTimes(1);

    // Marker đã bị xóa hoàn toàn
    expect(await otpService.isPhoneVerified(phone)).toBe(false);
  });

  it('Test 7 — Phone đã tồn tại -> fail ConflictException và KHÔNG làm mất marker OTP', async () => {
    const phone = getNextPhone();

    // Giả lập user đã tồn tại sẵn trong DB
    usersService.findByPhoneNumber.mockResolvedValueOnce({
      userId: 'existing-id',
      phoneNumber: phone,
      fullName: 'Already Registered',
    });

    // User vừa verify OTP thành công
    await otpService.setPhoneVerified(phone, 600);
    expect(await otpService.isPhoneVerified(phone)).toBe(true);

    // Gọi register -> Phải ném ConflictException
    await expect(
      authService.register({
        fullName: 'New Name',
        phoneNumber: phone,
        password: 'Password123!',
      }),
    ).rejects.toThrow(ConflictException);

    // QUAN TRỌNG: Marker OTP KHÔNG bị consume oan, vẫn còn nguyên trong Redis
    expect(await otpService.isPhoneVerified(phone)).toBe(true);
  });

  it('Test 8 — Database error -> Register fail và khôi phục lại marker OTP', async () => {
    const phone = getNextPhone();

    // Giả lập database lỗi khi lưu User
    usersService.createUser.mockRejectedValueOnce(new Error('PostgreSQL deadlock error'));

    // Đặt marker verified
    await otpService.setPhoneVerified(phone, 600);

    // Register thất bại do lỗi DB
    await expect(
      authService.register({
        fullName: 'DB Error User',
        phoneNumber: phone,
        password: 'Password123!',
      }),
    ).rejects.toThrow('PostgreSQL deadlock error');

    // Marker OTP phải được khôi phục, không làm mất quyền đăng ký của user
    expect(await otpService.isPhoneVerified(phone)).toBe(true);
  });

  it('Test 9 — Redis failure khi kiểm tra marker -> fail-closed, không tạo user', async () => {
    const brokenOtpService = {
      isPhoneVerified: vi.fn().mockRejectedValue(new Error('Redis cluster unreachable')),
      consumePhoneVerified: vi.fn().mockRejectedValue(new Error('Redis cluster unreachable')),
    } as unknown as OtpService;

    const failingAuthService = new AuthService(
      usersService,
      jwtService,
      configService,
      {} as any,
      {} as any,
      brokenOtpService,
    );

    // Khi Redis lỗi -> register phải fail-closed
    await expect(
      failingAuthService.register({
        fullName: 'Failing User',
        phoneNumber: '0912345678',
        password: 'Password123!',
      }),
    ).rejects.toThrow('Redis cluster unreachable');

    // Không được bypass và không được tạo user
    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it('Test 10 — Phone normalization đồng nhất giữa OTP và Register', async () => {
    const rawPhone = '0981 123 456';
    const cleanPhone = '0981123456';

    // Verify OTP với số đã chuẩn hóa
    const { otp } = await otpService.createAndSaveOtp(cleanPhone);
    await otpService.verifyOtp(cleanPhone, otp);

    // Register với số có khoảng trắng -> Hệ thống tự chuẩn hóa và nhận diện marker
    const res = await authService.register({
      fullName: 'Normalized Phone User',
      phoneNumber: rawPhone,
      password: 'Password123!',
    });

    expect(res).toBeDefined();
    expect(res.phoneNumber).toBe(cleanPhone);
    expect(await otpService.isPhoneVerified(cleanPhone)).toBe(false);
  });
});
