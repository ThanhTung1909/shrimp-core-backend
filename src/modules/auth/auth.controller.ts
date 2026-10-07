import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Ip,
  Optional,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';

import { UsersService } from '../users/users.service.js';
import { User } from '../users/entities/user.entity.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AllowMustChangePassword } from '../../common/decorators/allow-must-change-password.decorator.js';
import { RateLimitService } from '../../common/redis/rate-limit.service.js';
import {
  RATE_LIMIT_CONFIG,
  getLoginIpKey,
  getLoginPhoneKey,
  getRefreshIpKey,
  getRegisterIpKey,
  getOtpSendIpKey,
  getOtpSendPhoneKey,
  getOtpVerifyPhoneKey,
} from '../../common/redis/rate-limit.constants.js';

import { Public } from '../../common/decorators/public.decorator.js';

import { Gender } from '../../common/enums/gender.enum.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

export interface AuthenticatedRequest extends Request {
  user: Omit<User, 'passwordHash'>;
}

@ApiTags('Auth - Xác Thực & Phân Quyền')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    @Optional()
    private readonly rateLimitService?: RateLimitService,
    @Optional()
    private readonly jwtService?: JwtService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  private async applyRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    if (!this.rateLimitService) {
      return;
    }
    const result = await this.rateLimitService.checkLimit(
      key,
      limit,
      windowSeconds,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Quá nhiều yêu cầu, vui lòng thử lại sau!',
          retryAfter: result.retryAfterSeconds,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Extract jti and exp from the Bearer access token in the Authorization header.
   * Throws UnauthorizedException if the header is missing, malformed, or missing jti/exp.
   * Does NOT verify the signature here — passport-jwt already verified it before
   * this controller handler runs.
   */
  private extractAccessTokenClaims(
    authHeader: string | undefined,
  ): { jti: string; exp: number } {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu hoặc sai định dạng Authorization header!');
    }
    const token = authHeader.slice(7);
    try {
      const payload = this.jwtService
        ? (this.jwtService.decode(token) as any)
        : (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as any);

      if (
        !payload?.jti ||
        typeof payload.jti !== 'string' ||
        !payload?.exp ||
        !Number.isFinite(payload.exp)
      ) {
        throw new UnauthorizedException('Access token không hợp lệ!');
      }

      return {
        jti: payload.jti,
        exp: payload.exp,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Access token không hợp lệ!');
    }
  }

  @Public()
  @Post('send-otp')
  @ApiOperation({ summary: 'Gửi mã xác thực OTP qua SMS/Email' })
  @ApiResponse({ status: 200, description: 'Gửi mã OTP thành công' })
  @ApiResponse({ status: 429, description: 'Gửi quá nhiều yêu cầu OTP' })
  async sendOtp(
    @Body() sendOtpDto: SendOtpDto,
    @Ip() ip?: string,
  ): Promise<{
    message: string;
    phoneNumber: string;
    otp?: string;
    expiresIn: string;
  }> {
    await this.applyRateLimit(
      getOtpSendPhoneKey(sendOtpDto.phoneNumber),
      RATE_LIMIT_CONFIG.OTP_SEND.PHONE_LIMIT,
      RATE_LIMIT_CONFIG.OTP_SEND.PHONE_WINDOW,
    );
    await this.applyRateLimit(
      getOtpSendIpKey(ip),
      RATE_LIMIT_CONFIG.OTP_SEND.IP_LIMIT,
      RATE_LIMIT_CONFIG.OTP_SEND.IP_WINDOW,
    );
    return this.authService.sendOtp(sendOtpDto);
  }

  /**
   * POST /auth/forgot-password
   * Public endpoint. Triggers a RESET_PASSWORD OTP for the given phoneNumber.
   * Anti-enumeration: always returns 200 with a consistent message.
   * Reuses the existing OTP/SMS infrastructure via sendOtp internally.
   */
  @Public()
  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip?: string,
  ): Promise<{
    message: string;
    phoneNumber: string;
    otp?: string;
    expiresIn: string;
  }> {
    await this.applyRateLimit(
      getOtpSendPhoneKey(dto.phoneNumber),
      RATE_LIMIT_CONFIG.OTP_SEND.PHONE_LIMIT,
      RATE_LIMIT_CONFIG.OTP_SEND.PHONE_WINDOW,
    );
    await this.applyRateLimit(
      getOtpSendIpKey(ip),
      RATE_LIMIT_CONFIG.OTP_SEND.IP_LIMIT,
      RATE_LIMIT_CONFIG.OTP_SEND.IP_WINDOW,
    );
    return this.authService.forgotPassword(dto.phoneNumber);
  }

  @Public()
  @Post('verify-otp')
  @ApiOperation({ summary: 'Xác thực mã OTP' })
  @ApiResponse({ status: 200, description: 'Xác thực mã OTP hợp lệ thành công' })
  @ApiResponse({ status: 400, description: 'Mã OTP không hợp lệ hoặc đã hết hạn' })
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<any> {
    await this.applyRateLimit(
      getOtpVerifyPhoneKey(verifyOtpDto.phoneNumber),
      RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_LIMIT,
      RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_WINDOW,
    );
    return this.authService.verifyOtp(verifyOtpDto, userAgent);
  }

  @Post('register')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Quản trị viên đăng ký tài khoản người dùng mới' })
  @ApiResponse({ status: 201, description: 'Tạo tài khoản thành công' })
  @ApiResponse({ status: 409, description: 'Số điện thoại hoặc email đã được sử dụng' })
  async register(
    @CurrentUser('role') actorRole: Role,
    @Body() registerDto: RegisterDto,
    @Ip() ip?: string,
    @Headers('user-agent') _userAgent?: string,
  ): Promise<{
    message: string;
    userId: string;
    fullName: string;
    phoneNumber: string;
    email: string | null;
    role: Role;
  }> {
    await this.applyRateLimit(
      getRegisterIpKey(ip),
      RATE_LIMIT_CONFIG.REGISTER.IP_LIMIT,
      RATE_LIMIT_CONFIG.REGISTER.IP_WINDOW,
    );
    return this.authService.register(registerDto, actorRole);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Đăng nhập hệ thống bằng số điện thoại và mật khẩu' })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công trả về cặp Access & Refresh tokens' })
  @ApiResponse({ status: 401, description: 'Sai số điện thoại hoặc mật khẩu' })
  async login(
    @Body() loginDto: LoginDto,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    userId: string;
    fullName: string;
    phoneNumber: string;
    role: Role;
    tokenVersion: number;
    mustChangePassword: boolean;
    accessToken: string;
    refreshToken: string;
  }> {
    await this.applyRateLimit(
      getLoginIpKey(ip),
      RATE_LIMIT_CONFIG.LOGIN.IP_LIMIT,
      RATE_LIMIT_CONFIG.LOGIN.IP_WINDOW,
    );
    await this.applyRateLimit(
      getLoginPhoneKey(loginDto.phoneNumber),
      RATE_LIMIT_CONFIG.LOGIN.PHONE_LIMIT,
      RATE_LIMIT_CONFIG.LOGIN.PHONE_WINDOW,
    );
    return this.authService.login(loginDto, userAgent);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Làm mới Access Token bằng Refresh Token' })
  @ApiResponse({ status: 200, description: 'Cấp mới thành công cặp Access & Refresh tokens' })
  @ApiResponse({ status: 401, description: 'Refresh token không hợp lệ hoặc đã bị thu hồi' })
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Ip() ip?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    await this.applyRateLimit(
      getRefreshIpKey(ip),
      RATE_LIMIT_CONFIG.REFRESH.IP_LIMIT,
      RATE_LIMIT_CONFIG.REFRESH.IP_WINDOW,
    );
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Đặt lại mật khẩu mới thông qua OTP xác thực' })
  @ApiResponse({ status: 200, description: 'Đặt lại mật khẩu thành công' })
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'Lấy thông tin tài khoản người dùng đang đăng nhập' })
  @ApiResponse({ status: 200, description: 'Trả về profile thông tin cá nhân' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập hoặc token đã hết hạn' })
  async me(@Req() req: AuthenticatedRequest): Promise<{
    userId: string;
    fullName: string;
    phoneNumber: string;
    email: string | null;
    gender: Gender | null;
    dateOfBirth: Date | string | null;
    role: Role;
    isActive: boolean;
    mustChangePassword: boolean;
    tokenVersion: number;
  }> {
    const user = req.user;
    return {
      userId: user.userId,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      gender: user.gender,
      dateOfBirth: user.dateOfBirth,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      tokenVersion: user.tokenVersion,
    };
  }

  @Post('change-password')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'Đổi mật khẩu người dùng' })
  @ApiResponse({ status: 200, description: 'Đổi mật khẩu thành công' })
  @ApiResponse({ status: 400, description: 'Mật khẩu cũ không chính xác' })
  async changePassword(
    @CurrentUser('userId') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<{
    message: string;
    userId: string;
    tokenVersion: number;
    mustChangePassword: boolean;
    accessToken: string;
    refreshToken: string;
  }> {
    return this.authService.changePassword(
      userId,
      changePasswordDto,
    );
  }

  @Post('logout')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'Đăng xuất khỏi thiết bị hiện tại (Vô hiệu hóa Refresh Token)' })
  @ApiResponse({ status: 200, description: 'Đăng xuất thành công' })
  async logout(
    @CurrentUser('userId') userId: string,
    @Body() logoutDto: LogoutDto,
    @Headers('authorization') authHeader?: string,
  ): Promise<{ message: string }> {
    let jti: string | undefined;
    let exp: number | undefined;
    if (authHeader) {
      const claims = this.extractAccessTokenClaims(authHeader);
      jti = claims.jti;
      exp = claims.exp;
    }
    return this.authService.logout(userId, logoutDto.refreshToken, jti, exp);
  }

  @Post('logout-all')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'Đăng xuất khỏi tất cả các thiết bị đang đăng nhập' })
  @ApiResponse({ status: 200, description: 'Đăng xuất tất cả thiết bị thành công' })
  async logoutAll(@CurrentUser('userId') userId: string): Promise<{ message: string }> {
    return this.authService.logoutAll(userId);
  }
}
