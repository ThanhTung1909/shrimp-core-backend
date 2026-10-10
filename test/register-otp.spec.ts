import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { Role } from '../src/common/enums/role.enum.js';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

describe('MANAGER ONBOARDING REGISTRATION SUITE', () => {
  let authService: AuthService;
  let usersService: any;
  let jwtService: JwtService;
  let configService: ConfigService;
  let emailService: any;
  let dataSource: any;

  let usersDb: Map<string, any>;
  let emailSentLog: any[];

  beforeEach(() => {
    usersDb = new Map<string, any>();
    emailSentLog = [];

    configService = new ConfigService({
      JWT_ACCESS_SECRET: 'test_jwt_access_secret_key_1234567890123456',
      JWT_REFRESH_SECRET: 'test_jwt_refresh_secret_key_1234567890123456',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });

    jwtService = new JwtService({
      secret: 'test_jwt_access_secret_key_1234567890123456',
    });

    usersService = {
      findByPhoneNumber: vi.fn(async (phone: string) => {
        for (const u of usersDb.values()) {
          if (u.phoneNumber === phone) return u;
        }
        return null;
      }),
      findByEmail: vi.fn(async (email: string) => {
        for (const u of usersDb.values()) {
          if (u.email === email) return u;
        }
        return null;
      }),
      createUser: vi.fn(async (data: any, _manager?: any) => {
        const user = {
          userId: 'user-' + Math.random().toString(36).substring(2, 9),
          tokenVersion: 0,
          isActive: true,
          ...data,
        };
        usersDb.set(data.phoneNumber, user);
        return user;
      }),
    };

    emailService = {
      sendInitialPassword: vi.fn(
        async (email: string, fullName: string, phone: string, plainPass: string) => {
          emailSentLog.push({ email, fullName, phone, plainPass });
        },
      ),
    };

    dataSource = {
      transaction: vi.fn(async (callback: any) => {
        const manager = {};
        return await callback(manager);
      }),
    };

    authService = new AuthService(
      usersService,
      jwtService,
      configService,
      {} as any,
      dataSource,
      emailService,
      {} as any,
    );
  });

  it('Test 1 — Đăng ký thành công nhân viên mới: Tạo user, băm mật khẩu, gán role, mustChangePassword=true, gửi email và không trả token', async () => {
    const registerDto = {
      fullName: 'Tran Van Staff',
      phoneNumber: '0987654321',
      email: 'staff@example.com',
      role: Role.TECHNICIAN,
    };

    const res = await authService.register(registerDto);

    // 1. Phản hồi thành công đúng định dạng
    expect(res).toBeDefined();
    expect(res.message).toBe(
      'Đăng ký tài khoản thành công. Mật khẩu đã được gửi về email.',
    );
    expect(res.userId).toBeDefined();
    expect(res.fullName).toBe('Tran Van Staff');
    expect(res.phoneNumber).toBe('0987654321');
    expect(res.email).toBe('staff@example.com');
    expect(res.role).toBe(Role.TECHNICIAN);

    // 2. Không trả access/refresh token hoặc password trong response
    expect((res as any).accessToken).toBeUndefined();
    expect((res as any).refreshToken).toBeUndefined();
    expect((res as any).password).toBeUndefined();
    expect((res as any).passwordHash).toBeUndefined();

    // 3. User được tạo trong DB với mustChangePassword = true và hash hợp lệ
    expect(usersService.createUser).toHaveBeenCalledTimes(1);
    const createdArgs = usersService.createUser.mock.calls[0][0];
    expect(createdArgs.mustChangePassword).toBe(true);
    expect(createdArgs.role).toBe(Role.TECHNICIAN);
    expect(createdArgs.passwordHash).toBeDefined();

    // 4. Email chứa plainPassword được gửi
    expect(emailService.sendInitialPassword).toHaveBeenCalledTimes(1);
    expect(emailSentLog).toHaveLength(1);
    const sentEmail = emailSentLog[0];
    expect(sentEmail.email).toBe('staff@example.com');
    expect(sentEmail.fullName).toBe('Tran Van Staff');
    expect(sentEmail.phone).toBe('0987654321');
    expect(sentEmail.plainPass).toHaveLength(8);

    // 5. Plain password trong email khớp chính xác với passwordHash trong DB
    const isMatch = await bcrypt.compare(
      sentEmail.plainPass,
      createdArgs.passwordHash,
    );
    expect(isMatch).toBe(true);
  });

  it('Test 2 — Trùng số điện thoại -> Bị từ chối ConflictException', async () => {
    usersDb.set('0987654321', {
      userId: 'existing-user-1',
      phoneNumber: '0987654321',
      email: 'other@example.com',
    });

    const registerDto = {
      fullName: 'Duplicate Phone User',
      phoneNumber: '0987654321',
      email: 'newemail@example.com',
      role: Role.FARMER,
    };

    await expect(authService.register(registerDto)).rejects.toThrow(
      'Số điện thoại này đã được đăng ký!',
    );

    expect(usersService.createUser).not.toHaveBeenCalled();
    expect(emailService.sendInitialPassword).not.toHaveBeenCalled();
  });

  it('Test 3 — Trùng email -> Bị từ chối ConflictException', async () => {
    usersDb.set('0911111111', {
      userId: 'existing-user-2',
      phoneNumber: '0911111111',
      email: 'existing@example.com',
    });

    const registerDto = {
      fullName: 'Duplicate Email User',
      phoneNumber: '0922222222',
      email: 'existing@example.com',
      role: Role.FARMER,
    };

    await expect(authService.register(registerDto)).rejects.toThrow(
      'Email này đã được sử dụng bởi tài khoản khác!',
    );

    expect(usersService.createUser).not.toHaveBeenCalled();
    expect(emailService.sendInitialPassword).not.toHaveBeenCalled();
  });

  it('Test 4 — Số điện thoại rỗng/khoảng trắng -> Bị từ chối BadRequestException', async () => {
    const registerDto = {
      fullName: 'Invalid Phone User',
      phoneNumber: '   ',
      email: 'valid@example.com',
      role: Role.FARMER,
    };

    await expect(authService.register(registerDto)).rejects.toThrow(
      'Số điện thoại không hợp lệ!',
    );

    expect(usersService.createUser).not.toHaveBeenCalled();
  });

  it('Test 5 — Chuẩn hóa số điện thoại tự động (bỏ khoảng trắng, format chuẩn)', async () => {
    const registerDto = {
      fullName: 'Spaces Phone User',
      phoneNumber: '0987 654 321',
      email: 'spaces@example.com',
      role: Role.FARMER,
    };

    const res = await authService.register(registerDto);
    expect(res.phoneNumber).toBe('0987654321');
    expect(usersService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '0987654321',
      }),
      expect.anything(),
    );
  });

  it('Test 6 — Gửi email thất bại -> Transaction ném InternalServerErrorException và rollback', async () => {
    emailService.sendInitialPassword.mockRejectedValueOnce(
      new Error('SMTP connection timed out'),
    );

    const registerDto = {
      fullName: 'Email Fail User',
      phoneNumber: '0933333333',
      email: 'failmail@example.com',
      role: Role.TECHNICIAN,
    };

    await expect(authService.register(registerDto)).rejects.toThrow(
      'Không thể gửi email mật khẩu khởi tạo. Vui lòng thử lại sau!',
    );
  });

  it('Test 7 — Tạo User trong DB thất bại -> Ném lỗi và không gửi email', async () => {
    usersService.createUser.mockRejectedValueOnce(
      new Error('DB connection pool exhausted'),
    );

    const registerDto = {
      fullName: 'DB Error User',
      phoneNumber: '0944444444',
      email: 'dberror@example.com',
      role: Role.TECHNICIAN,
    };

    await expect(authService.register(registerDto)).rejects.toThrow(
      'DB connection pool exhausted',
    );
    expect(emailService.sendInitialPassword).not.toHaveBeenCalled();
  });
});
