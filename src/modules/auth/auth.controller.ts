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
import { SendOtpDto } from './dto/send-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
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

export interface AuthenticatedRequest extends Request {
  user: Omit<User, 'passwordHash'>;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    @Optional()
    private readonly rateLimitService?: RateLimitService,
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

  @Public()
  @Post('send-otp')
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

  @Public()
  @Post('verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
  ): Promise<{
    message: string;
    phoneNumber: string;
    isValid: boolean;
  }> {
    await this.applyRateLimit(
      getOtpVerifyPhoneKey(verifyOtpDto.phoneNumber),
      RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_LIMIT,
      RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_WINDOW,
    );
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.MANAGER)
  async register(
    @Body() registerDto: RegisterDto,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
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
    return this.authService.register(registerDto, userAgent);
  }

  @Public()
  @Post('login')
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
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
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
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
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  async logout(
    @CurrentUser('userId') userId: string,
    @Body() logoutDto: LogoutDto,
  ): Promise<{ message: string }> {
    return this.authService.logout(userId, logoutDto.refreshToken);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @AllowMustChangePassword()
  async logoutAll(@CurrentUser('userId') userId: string): Promise<{ message: string }> {
    return this.authService.logoutAll(userId);
  }
}
