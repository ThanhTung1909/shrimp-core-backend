import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto.js';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { Role } from '../../common/enums/role.enum.js';
import { UserSession } from './entities/user-session.entity.js';
import { OtpService } from './otp.service.js';
import { normalizePhone, getAccessTokenBlacklistKey } from '../../common/redis/rate-limit.constants.js';
import { OtpPurpose } from '../../common/redis/otp.constants.js';
import { LoginSecurityService } from '../../common/redis/login-security.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { EmailService } from '../email/email.service.js';
import { EsmsService } from '../../common/esms/esms.service.js';

const DUMMY_HASH =
  '$2b$10$e8N8y2D2.f6Zf2g8H6J7K.1234567890abcdefghijklmnopqrstuv';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(UserSession)
    private readonly userSessionRepository: Repository<UserSession>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly esmsService: EsmsService,
    @Optional()
    private readonly otpService?: OtpService,
    @Optional()
    private readonly loginSecurityService?: LoginSecurityService,
    @Optional()
    private readonly redisService?: RedisService,
  ) {}

  //Hàm gửi OTP (Lưu SHA-256 hash vào Redis với TTL 5 phút)
  async sendOtp(sendOtpDto: SendOtpDto): Promise<{
    message: string;
    phoneNumber: string;
    otp?: string;
    expiresIn: string;
  }> {
    const existingUser = await this.userService.findByPhoneNumber(
      sendOtpDto.phoneNumber,
    );
    if (sendOtpDto.purpose === OtpPurpose.REGISTER && existingUser) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký trong hệ thống!',
      );
    }

      if (sendOtpDto.purpose === OtpPurpose.LOGIN && !existingUser) {
      throw new UnauthorizedException('Tài khoản không tồn tại trong hệ thống!');
    }
    if (sendOtpDto.purpose === OtpPurpose.LOGIN && existingUser && existingUser.isLoginLocked) {
      throw new UnauthorizedException('Vui lòng liên hệ quản lý');
    }

    if (
      sendOtpDto.purpose === OtpPurpose.RESET_PASSWORD &&
      !existingUser
    ) {
      return {
        message: 'Nếu số điện thoại hợp lệ, mã OTP đã được gửi',
        phoneNumber: sendOtpDto.phoneNumber,
        expiresIn: '5 phút',
      };
    }

    if (
      sendOtpDto.purpose === OtpPurpose.CHANGE_PASSWORD &&
      !existingUser
    ) {
        throw new UnauthorizedException('Tài khoản không tồn tại trong hệ thống!');;
    }

      let otp: string | undefined;
      if (this.otpService) {
        const result = await this.otpService.createAndSaveOtp(
          sendOtpDto.purpose,
          sendOtpDto.phoneNumber,
        );
        otp = result.otp;

        // Gửi SMS qua eSMS
        await this.esmsService.sendSMS(sendOtpDto.phoneNumber, otp);
      } else {
        if (process.env.NODE_ENV === 'production') {
          throw new InternalServerErrorException(
            'Dịch vụ OTP chưa sẵn sàng, vui lòng liên hệ quản trị viên!',
          );
        }
        otp = '123456';
      }

      return {
        message: 'Mã OTP đã được gửi thành công!',
        phoneNumber: sendOtpDto.phoneNumber,
        ...(process.env.NODE_ENV === 'production' ? {} : { otp }),
        expiresIn: '5 phút',
    };
  }

  /**
   * POST /auth/forgot-password — thin alias for sendOtp with RESET_PASSWORD purpose.
   * Accepts only phoneNumber; purpose is hardcoded so this endpoint is self-contained.
   * Anti-enumeration: same response shape regardless of whether the phone is registered.
   */
  async forgotPassword(phoneNumber: string): Promise<{
    message: string;
    phoneNumber: string;
    otp?: string;
    expiresIn: string;
  }> {
    return this.sendOtp({ phoneNumber, purpose: OtpPurpose.RESET_PASSWORD });
  }


  //Hàm xác thực OTP (Xác thực atomic bằng Redis Lua Script)
  async verifyOtp(verifyOtpDto: VerifyOtpDto, deviceName?: string | null): Promise<any> {
    if (this.otpService) {
      await this.otpService.verifyOtp(
        verifyOtpDto.purpose,
        verifyOtpDto.phoneNumber,
        verifyOtpDto.otp,
      );
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'Dịch vụ OTP chưa sẵn sàng, vui lòng liên hệ quản trị viên!',
        );
      }
      const MOCK_OTP = '123456';
      if (verifyOtpDto.otp !== MOCK_OTP) {
        throw new BadRequestException(
          'Mã OTP không chính xác hoặc đã hết hạn!',
        );
      }
    }

    if (verifyOtpDto.purpose === OtpPurpose.LOGIN) {
      if (this.otpService) {
        await this.otpService.consumePhoneVerified(verifyOtpDto.purpose, verifyOtpDto.phoneNumber);
      }

      const user = await this.userService.findByPhoneNumber(verifyOtpDto.phoneNumber, true);
      if (!user) {
        throw new UnauthorizedException('Tài khoản không tồn tại trong hệ thống!');
      }

      if (!user.isActive) {
        throw new UnauthorizedException(
          'Tài khoản của bạn đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quản trị viên!',
        );
      }

      if (user.isLoginLocked) {
        throw new UnauthorizedException({
          code: 'LOGIN_PERMANENTLY_LOCKED',
          message: 'Vui lòng liên hệ quản lý',
        });
      }

      if (this.loginSecurityService) {
        const lockTtl = await this.loginSecurityService.getTemporaryLockTtl(user.userId);
        if (lockTtl > 0) {
          throw new UnauthorizedException({
            code: 'LOGIN_TEMPORARILY_LOCKED',
            message: `Tài khoản tạm thời bị khóa. Vui lòng thử lại sau ${lockTtl} giây.`,
            retryAfterSeconds: lockTtl,
          });
        }
        await this.loginSecurityService.clear(user.userId);
      }

      const accessPayload = {
        sub: user.userId,
        phoneNumber: user.phoneNumber,
        tokenVersion: user.tokenVersion,
        role: user.role,
        type: 'access',
      };

      const refreshPayload = {
        sub: user.userId,
        tokenVersion: user.tokenVersion,
        role: user.role,
        type: 'refresh',
      };

      const accessToken = await this.jwtService.signAsync(accessPayload, {
        jwtid: crypto.randomUUID(),
      });

      const refreshToken = await this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithm: 'HS256',
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
        jwtid: crypto.randomUUID(),
      });

      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const tokenFamily = crypto.randomUUID();
      const decoded = this.jwtService.decode(refreshToken) as { exp?: number } | null;

      if (!decoded?.exp || !Number.isFinite(decoded.exp)) {
        throw new UnauthorizedException('Lỗi khởi tạo phiên đăng nhập!');
      }

      const expiresAt = new Date(decoded.exp * 1000);

      const session = this.userSessionRepository.create({
        userId: user.userId,
        refreshTokenHash,
        tokenFamily,
        deviceName: deviceName || null,
        expiresAt,
      });

      await this.userSessionRepository.save(session);

      return {
        message: 'Đăng nhập thành công!',
        userId: user.userId,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role,
        tokenVersion: user.tokenVersion,
        mustChangePassword: user.mustChangePassword,
        accessToken,
        refreshToken,
      };
    }

    return {
      message: 'Xác thực OTP thành công!',
      phoneNumber: verifyOtpDto.phoneNumber,
      isValid: true,
    };
  }

  // Tạo mật khẩu ngẫu nhiên an toàn đúng 8 ký tự (chữ hoa, chữ thường, số)
  private generateInitialPassword(): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const allChars = uppercase + lowercase + numbers;

    // Đảm bảo có ít nhất 1 chữ hoa, 1 chữ thường và 1 chữ số
    const passwordChars: string[] = [
      uppercase[crypto.randomInt(0, uppercase.length)],
      lowercase[crypto.randomInt(0, lowercase.length)],
      numbers[crypto.randomInt(0, numbers.length)],
    ];

    // 5 ký tự ngẫu nhiên còn lại từ tất cả các tập
    for (let i = 0; i < 5; i++) {
      passwordChars.push(allChars[crypto.randomInt(0, allChars.length)]);
    }

    // Xáo trộn vị trí các ký tự (Fisher-Yates shuffle)
    for (let i = passwordChars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [passwordChars[i], passwordChars[j]] = [
        passwordChars[j],
        passwordChars[i],
      ];
    }

    return passwordChars.join('');
  }

  // Hàm đăng ký tài khoản (Tự động sinh mật khẩu, lưu DB bằng transaction, gửi mật khẩu qua email)
  async register(
    registerDto: RegisterDto,
    _deviceName?: string | null,
  ): Promise<{
    message: string;
    userId: string;
    fullName: string;
    phoneNumber: string;
    email: string | null;
    role: Role;
  }> {
    const normalizedPhone = normalizePhone(registerDto.phoneNumber);
    if (!normalizedPhone) {
      throw new BadRequestException('Số điện thoại không hợp lệ!');
    }

    // 1. Kiểm tra trùng số điện thoại
    const existingUserByPhone =
      await this.userService.findByPhoneNumber(normalizedPhone);
    if (existingUserByPhone) {
      throw new ConflictException('Số điện thoại này đã được đăng ký!');
    }

    // 2. Kiểm tra trùng email
    const existingUserByEmail = await this.userService.findByEmail(
      registerDto.email,
    );
    if (existingUserByEmail) {
      throw new ConflictException(
        'Email này đã được sử dụng bởi tài khoản khác!',
      );
    }

    // 3. Sinh mật khẩu ngẫu nhiên đúng 8 ký tự và băm bằng bcrypt
    const plainPassword = this.generateInitialPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    // 4. Thực thi transaction: Tạo user và gửi email
    // Nếu gửi email thất bại, transaction sẽ tự động rollback (không để lại user dở dang trong DB)
    return await this.dataSource.transaction(async (manager) => {
      const user = await this.userService.createUser(
        {
          fullName: registerDto.fullName,
          phoneNumber: normalizedPhone,
          email: registerDto.email,
          role: registerDto.role,
          passwordHash,
          mustChangePassword: true,
        },
        manager,
      );

      // 5. Gửi email mật khẩu khởi tạo (không log password ra console)
      try {
        await this.emailService.sendInitialPassword(
          registerDto.email,
          registerDto.fullName,
          normalizedPhone,
          plainPassword,
        );
      } catch {
        throw new InternalServerErrorException(
          'Không thể gửi email mật khẩu khởi tạo. Vui lòng thử lại sau!',
        );
      }

      // 6. Trả về response thành công (không trả password, passwordHash, accessToken, refreshToken)
      return {
        message: 'Đăng ký tài khoản thành công. Mật khẩu đã được gửi về email.',
        userId: user.userId,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        email: user.email,
        role: user.role,
      };
    });
  }

  //Hàm đăng nhập
  async login(loginDto: LoginDto, deviceName?: string | null) {
    const user = await this.userService.findByPhoneNumber(
      loginDto.phoneNumber,
      true,
    );

    if (user) {
      if (user.isLoginLocked) {
        throw new UnauthorizedException({
          code: 'LOGIN_PERMANENTLY_LOCKED',
          message: 'Vui lòng liên hệ quản lý',
        });
      }

      if (this.loginSecurityService) {
        const lockTtl = await this.loginSecurityService.getTemporaryLockTtl(user.userId);
        if (lockTtl > 0) {
          throw new UnauthorizedException({
            code: 'LOGIN_TEMPORARILY_LOCKED',
            message: `Tài khoản tạm thời bị khóa. Vui lòng thử lại sau ${lockTtl} giây.`,
            retryAfterSeconds: lockTtl,
          });
        }
      }
    }

    const hashToCompare = user?.passwordHash || DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      hashToCompare,
    );

    if (!user) {
      throw new UnauthorizedException(
        'Số điện thoại hoặc mật khẩu không đúng!',
      );
    }

    if (!isPasswordValid) {
      if (this.loginSecurityService) {
        const attempts = await this.loginSecurityService.recordFailure(user.userId);
        if (attempts === 3) {
          await this.loginSecurityService.createTemporaryLock(user.userId, 30);
        } else if (attempts === 5) {
          await this.loginSecurityService.createTemporaryLock(user.userId, 60);
        } else if (attempts === 10) {
          await this.userService.setLoginLocked(user.userId, true);
          await this.loginSecurityService.clear(user.userId);
        }
      }
      throw new UnauthorizedException(
        'Số điện thoại hoặc mật khẩu không đúng!',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Tài khoản của bạn đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quản trị viên!',
      );
    }

    if (this.loginSecurityService) {
      await this.loginSecurityService.clear(user.userId);
    }

    const accessPayload = {
      sub: user.userId,
      phoneNumber: user.phoneNumber,
      tokenVersion: user.tokenVersion,
      role: user.role,
      type: 'access',
    };

    const refreshPayload = {
      sub: user.userId,
      tokenVersion: user.tokenVersion,
      role: user.role,
      type: 'refresh',
    };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      jwtid: crypto.randomUUID(),
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      algorithm: 'HS256',
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
        '7d') as any,
      jwtid: crypto.randomUUID(),
    });

    // Tạo server-side session cho Refresh Token (Phase 3)
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const tokenFamily = crypto.randomUUID();

    const decoded = this.jwtService.decode(refreshToken) as {
      exp?: number;
    } | null;

    if (!decoded?.exp || !Number.isFinite(decoded.exp)) {
      throw new UnauthorizedException('Refresh token không hợp lệ!');
    }

    const expiresAt = new Date(decoded.exp * 1000);

    const session = this.userSessionRepository.create({
      userId: user.userId,
      refreshTokenHash,
      tokenFamily,
      deviceName: deviceName || null,
      expiresAt,
    });

    await this.userSessionRepository.save(session);

    return {
      userId: user.userId,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      tokenVersion: user.tokenVersion,
      mustChangePassword: user.mustChangePassword,
      accessToken,
      refreshToken,
    };
  }

  //Hàm làm mới token (Refresh Token Rotation - Phase 4)
  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Refresh token không hợp lệ!');
      }
      const user = await this.userService.findById(payload.sub);

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Refresh token không hợp lệ!');
      }

      if (user.tokenVersion !== payload.tokenVersion) {
        throw new UnauthorizedException('Refresh token không hợp lệ!');
      }

      const refreshTokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');

      const existingSession = await this.userSessionRepository.findOne({
        where: { refreshTokenHash },
      });

      if (!existingSession) {
        throw new UnauthorizedException('Refresh token không hợp lệ!');
      }

      if (existingSession.revokedAt !== null) {
        // Refresh Token Reuse Detected (Phase 5)
        // Revoke toàn bộ các session đang ACTIVE trong cùng tokenFamily
        await this.userSessionRepository.update(
          {
            tokenFamily: existingSession.tokenFamily,
            revokedAt: IsNull(),
          },
          {
            revokedAt: new Date(),
            revokeReason: 'REUSE_DETECTED',
          },
        );
        throw new UnauthorizedException('Refresh token không hợp lệ!');
      }

      return await this.dataSource.transaction(async (manager) => {
        const session = await manager.findOne(UserSession, {
          where: { refreshTokenHash },
          lock: { mode: 'pessimistic_write' },
        });

        if (!session) {
          throw new UnauthorizedException('Refresh token không hợp lệ!');
        }

        if (session.revokedAt !== null) {
          // Refresh Token Reuse Detected (Phase 5)
          // Revoke toàn bộ các session đang ACTIVE trong cùng tokenFamily
          await manager.update(
            UserSession,
            {
              tokenFamily: session.tokenFamily,
              revokedAt: IsNull(),
            },
            {
              revokedAt: new Date(),
              revokeReason: 'REUSE_DETECTED',
            },
          );
          throw new UnauthorizedException('Refresh token không hợp lệ!');
        }

        if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
          throw new UnauthorizedException('Refresh token đã hết hạn!');
        }

        if (session.userId !== user.userId) {
          throw new UnauthorizedException('Refresh token không hợp lệ!');
        }

        // 1. Revoke old session
        session.revokedAt = new Date();
        session.revokeReason = 'ROTATED';
        await manager.save(UserSession, session);

        // 2. Tạo tokens mới
        const newAccessToken = await this.jwtService.signAsync(
          {
            sub: user.userId,
            phoneNumber: user.phoneNumber,
            tokenVersion: user.tokenVersion,
            role: user.role,
            type: 'access',
          },
          {
            jwtid: crypto.randomUUID(),
          },
        );

        const newRefreshToken = await this.jwtService.signAsync(
          {
            sub: user.userId,
            tokenVersion: user.tokenVersion,
            role: user.role,
            type: 'refresh',
          },
          {
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
            algorithm: 'HS256',
            expiresIn: (this.configService.get<string>(
              'JWT_REFRESH_EXPIRES_IN',
            ) || '7d') as any,
            jwtid: crypto.randomUUID(),
          },
        );

        // 3. Hash token mới và lấy expiration
        const newRefreshTokenHash = crypto
          .createHash('sha256')
          .update(newRefreshToken)
          .digest('hex');

        const decoded = this.jwtService.decode(newRefreshToken) as {
          exp?: number;
        } | null;

        if (!decoded?.exp || !Number.isFinite(decoded.exp)) {
          throw new UnauthorizedException('Refresh token không hợp lệ!');
        }

        const newExpiresAt = new Date(decoded.exp * 1000);

        // 4. Tạo session mới kế thừa cùng tokenFamily
        const newSession = manager.create(UserSession, {
          userId: user.userId,
          tokenFamily: session.tokenFamily,
          refreshTokenHash: newRefreshTokenHash,
          deviceName: session.deviceName,
          expiresAt: newExpiresAt,
        });

        await manager.save(UserSession, newSession);

        return {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Refresh token không hợp lệ!');
    }
  }

  // Hàm đặt lại mật khẩu bằng OTP (Phase 7 - Change Password & Revoke All Sessions)
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await this.userService.findByPhoneNumber(
      resetPasswordDto.phoneNumber,
    );

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Không tìm thấy người dùng!');
    }

    let isValid = false;
    if (this.otpService) {
      isValid = await this.otpService.consumePhoneVerified(
        OtpPurpose.RESET_PASSWORD,
        resetPasswordDto.phoneNumber,
      );
    } else {
      isValid = true;
    }

    if (!isValid) {
      throw new UnauthorizedException(
        'Chưa xác thực OTP hoặc phiên xác thực đã hết hạn!',
      );
    }

    const newPasswordHash = await bcrypt.hash(
      resetPasswordDto.newPassword,
      10,
    );

    return await this.dataSource.transaction(async (manager) => {
      // 1. Đổi mật khẩu
      await this.userService.updatePassword(
        user.userId,
        newPasswordHash,
        manager,
      );

      // 2. Tăng tokenVersion để vô hiệu hoá tất cả token cũ
      await this.userService.incrementTokenVersion(user.userId, manager);

      // 3. Revoke toàn bộ session cũ
      await manager.update(
        UserSession,
        {
          userId: user.userId,
          revokedAt: IsNull(),
        },
        {
          revokedAt: new Date(),
          revokeReason: 'PASSWORD_RESET',
        },
      );

      // Unlock account
      await this.userService.setLoginLocked(user.userId, false, manager);
      if (this.loginSecurityService) {
        await this.loginSecurityService.clear(user.userId);
      }

      return {
        message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
      };
    });
  }

  // Hàm thay đổi mật khẩu (Phase 7 - Change Password & Revoke All Sessions)
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.userService.findById(userId, true);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Không tìm thấy người dùng!');
    }

    const isPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Mật khẩu hiện tại không đúng!');
    }

    if (this.otpService) {
      await this.otpService.verifyOtp(
        OtpPurpose.CHANGE_PASSWORD,
        user.phoneNumber,
        changePasswordDto.otp,
      );
    } else {
      const MOCK_OTP = '123456';
      if (changePasswordDto.otp !== MOCK_OTP) {
        throw new BadRequestException(
          'Mã OTP không chính xác hoặc đã hết hạn!',
        );
      }
    }

    const refreshToken = changePasswordDto.refreshToken;
    let currentSession: UserSession | null = null;

    if (refreshToken) {
      try {
        const refreshPayload = await this.jwtService.verifyAsync(refreshToken, {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          algorithms: ['HS256'],
        });

        if (
          refreshPayload.type === 'refresh' &&
          refreshPayload.sub === userId
        ) {
          const refreshTokenHash = crypto
            .createHash('sha256')
            .update(refreshToken)
            .digest('hex');

          currentSession = await this.userSessionRepository.findOne({
            where: {
              refreshTokenHash,
              userId,
            },
          });
        }
      } catch {
        // Nếu token không giải mã được thì tạo session mới
      }
    }

    const newPasswordHash = await bcrypt.hash(
      changePasswordDto.newPassword,
      10,
    );

    return await this.dataSource.transaction(async (manager) => {
      const tokenFamily = currentSession?.tokenFamily || crypto.randomUUID();
      const deviceName = currentSession?.deviceName || null;

      // 2. Đổi mật khẩu
      await this.userService.updatePassword(userId, newPasswordHash, manager);

      // 3. Tăng tokenVersion và lấy version mới
      const newTokenVersion = await this.userService.incrementTokenVersion(
        userId,
        manager,
      );

      // 4. Revoke toàn bộ session cũ
      await manager.update(
        UserSession,
        {
          userId,
          revokedAt: IsNull(),
        },
        {
          revokedAt: new Date(),
          revokeReason: 'PASSWORD_CHANGED',
        },
      );

      // 5. Tạo Access Token mới cho thiết bị hiện tại
      const newAccessToken = await this.jwtService.signAsync(
        {
          sub: userId,
          phoneNumber: user.phoneNumber,
          tokenVersion: newTokenVersion,
          role: user.role,
          type: 'access',
        },
        {
          jwtid: crypto.randomUUID(),
        },
      );

      // 6. Tạo Refresh Token mới cho thiết bị hiện tại
      const newRefreshToken = await this.jwtService.signAsync(
        {
          sub: userId,
          tokenVersion: newTokenVersion,
          role: user.role,
          type: 'refresh',
        },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          algorithm: 'HS256',
          expiresIn: (this.configService.get<string>(
            'JWT_REFRESH_EXPIRES_IN',
          ) || '7d') as any,
          jwtid: crypto.randomUUID(),
        },
      );

      // 7. Hash Refresh Token mới
      const newRefreshTokenHash = crypto
        .createHash('sha256')
        .update(newRefreshToken)
        .digest('hex');

      // 8. Lấy thời gian hết hạn của Refresh Token mới
      const decoded = this.jwtService.decode(newRefreshToken) as {
        exp?: number;
      } | null;

      if (!decoded?.exp || !Number.isFinite(decoded.exp)) {
        throw new UnauthorizedException('Refresh token không hợp lệ!');
      }

      const newExpiresAt = new Date(decoded.exp * 1000);

      // 9. Tạo session mới cho thiết bị đang đổi mật khẩu
      const newSession = manager.create(UserSession, {
        userId,
        tokenFamily,
        refreshTokenHash: newRefreshTokenHash,
        deviceName,
        expiresAt: newExpiresAt,
      });

      await manager.save(UserSession, newSession);

      // 10. Trả token mới cho thiết bị hiện tại
      return {
        message: 'Thay đổi mật khẩu thành công!',
        userId,
        tokenVersion: newTokenVersion,
        mustChangePassword: false,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    });
  }

  // Hàm đăng xuất một thiết bị (Phase 6 - Per-device Logout)
  async logout(
    userId: string,
    refreshToken: string,
    accessTokenJti?: string,
    accessTokenExp?: number,
  ) {
    // Blacklist the current Access Token immediately so it cannot be reused
    // even within its remaining JWT lifetime.
    if (accessTokenJti !== undefined) {
      if (accessTokenExp === undefined || !Number.isFinite(accessTokenExp)) {
        throw new UnauthorizedException('Access token không hợp lệ!');
      }
      const now = Math.floor(Date.now() / 1000);
      const remainingTtl = accessTokenExp - now;
      if (remainingTtl > 0) {
        if (!this.redisService) {
          throw new InternalServerErrorException(
            'Dịch vụ Redis chưa sẵn sàng!',
          );
        }
        const blacklistKey = getAccessTokenBlacklistKey(accessTokenJti);
        try {
          await this.redisService.set(blacklistKey, '1', remainingTtl);
        } catch {
          // Redis failure must not silently report success — rethrow fail-closed
          throw new InternalServerErrorException(
            'Không thể thu hồi Access Token. Vui lòng thử lại!',
          );
        }
      }
      // If remainingTtl <= 0: token is already expired, no positive TTL blacklist entry needed
    }

    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });

      if (payload.type !== 'refresh' || payload.sub !== userId) {
        return {
          message: 'Đăng xuất thành công!',
        };
      }

      const refreshTokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');

      const session = await this.userSessionRepository.findOne({
        where: { refreshTokenHash },
      });

      if (!session || session.userId !== userId) {
        return {
          message: 'Đăng xuất thành công!',
        };
      }

      // Giữ nguyên lịch sử nếu session đã bị revoke trước đó
      if (session.revokedAt !== null) {
        return {
          message: 'Đăng xuất thành công!',
        };
      }

      session.revokedAt = new Date();
      session.revokeReason = 'LOGOUT';
      await this.userSessionRepository.save(session);

      return {
        message: 'Đăng xuất thành công!',
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('thu hồi Access Token')) {
        throw error;
      }
      // Refresh token không hợp lệ hoặc hết hạn -> trả response an toàn, không lộ thông tin
      return {
        message: 'Đăng xuất thành công!',
      };
    }
  }


  // Hàm đăng xuất tất cả thiết bị (Phase 6 - Logout All Devices)
  async logoutAll(userId: string) {
    await this.dataSource.transaction(async (manager) => {
      await this.userService.incrementTokenVersion(userId, manager);

      await manager.update(
        UserSession,
        {
          userId,
          revokedAt: IsNull(),
        },
        {
          revokedAt: new Date(),
          revokeReason: 'LOGOUT_ALL',
        },
      );
    });

    return {
      message: 'Đã đăng xuất khỏi tất cả thiết bị!',
    };
  }
}
