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
import { Role } from '../../common/enums/role.enum.js';
import { UserSession } from './entities/user-session.entity.js';
import { OtpService } from './otp.service.js';
import { normalizePhone } from '../../common/redis/rate-limit.constants.js';
import { EmailService } from '../email/email.service.js';

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
    @Optional()
    private readonly otpService?: OtpService,
  ) {}

  //Hàm gửi OTP (Lưu SHA-256 hash vào Redis với TTL 5 phút)
  async sendOtp(sendOtpDto: SendOtpDto) {
    const existingUser = await this.userService.findByPhoneNumber(
      sendOtpDto.phoneNumber,
    );
    if (existingUser) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký trong hệ thống!',
      );
    }

    let otp: string | undefined;
    if (this.otpService) {
      const result = await this.otpService.createAndSaveOtp(
        sendOtpDto.phoneNumber,
      );
      otp = result.otp;
    } else {
      otp = '123456';
    }

    return {
      message: 'Mã OTP đã được gửi thành công!',
      phoneNumber: sendOtpDto.phoneNumber,
      ...(process.env.NODE_ENV === 'production' ? {} : { otp }),
      expiresIn: '5 phút',
    };
  }

  //Hàm xác thực OTP (Xác thực atomic bằng Redis Lua Script)
  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    if (this.otpService) {
      await this.otpService.verifyOtp(
        verifyOtpDto.phoneNumber,
        verifyOtpDto.otp,
      );
    } else {
      const MOCK_OTP = '123456';
      if (verifyOtpDto.otp !== MOCK_OTP) {
        throw new BadRequestException(
          'Mã OTP không chính xác hoặc đã hết hạn!',
        );
      }
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
  async register(registerDto: RegisterDto, _deviceName?: string | null) {
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
      } catch (error) {
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
    const user = await this.userService.findByPhoneNumber(loginDto.phoneNumber);
    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Số điện thoại hoặc mật khẩu không đúng!',
      );
    }
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Số điện thoại hoặc mật khẩu không đúng!',
      );
    }

    const accessPayload = {
      sub: user.userId,
      tokenVersion: user.tokenVersion,
      role: user.role,
      type: 'access',
    };

    const refreshPayload = {
      sub: user.userId,
      tokenVersion: user.tokenVersion,
      role: user.role,
      type: 'refresh',
      jti: crypto.randomUUID(),
    };
    const accessToken = await this.jwtService.signAsync(accessPayload);

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      algorithm: 'HS256',
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ||
        '7d') as any,
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
          await this.userSessionRepository.update(
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
        const newAccessToken = await this.jwtService.signAsync({
          sub: user.userId,
          tokenVersion: user.tokenVersion,
          role: user.role,
          type: 'access',
        });

        const newRefreshToken = await this.jwtService.signAsync(
          {
            sub: user.userId,
            tokenVersion: user.tokenVersion,
            role: user.role,
            type: 'refresh',
            jti: crypto.randomUUID(),
          },
          {
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
            algorithm: 'HS256',
            expiresIn: (this.configService.get<string>(
              'JWT_REFRESH_EXPIRES_IN',
            ) || '7d') as any,
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

  // Hàm thay đổi mật khẩu (Phase 7 - Change Password & Revoke All Sessions)
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.userService.findById(userId);

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

    const refreshToken = changePasswordDto.refreshToken;
    let currentSession: UserSession | null = null;

    if (refreshToken) {
      try {
        const refreshPayload = await this.jwtService.verifyAsync(refreshToken, {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          algorithms: ['HS256'],
        });

        if (refreshPayload.type === 'refresh' && refreshPayload.sub === userId) {
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
      const newAccessToken = await this.jwtService.signAsync({
        sub: userId,
        tokenVersion: newTokenVersion,
        role: user.role,
        type: 'access',
      });

      // 6. Tạo Refresh Token mới cho thiết bị hiện tại
      const newRefreshToken = await this.jwtService.signAsync(
        {
          sub: userId,
          tokenVersion: newTokenVersion,
          role: user.role,
          type: 'refresh',
          jti: crypto.randomUUID(),
        },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          algorithm: 'HS256',
          expiresIn: (this.configService.get<string>(
            'JWT_REFRESH_EXPIRES_IN',
          ) || '7d') as any,
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
  async logout(userId: string, refreshToken: string) {
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
    } catch {
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
