const fs = require('fs');

let serviceCode = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

if (!serviceCode.includes('async loginWithOtp')) {
  const loginWithOtpFunc = `
  async loginWithOtp(verifyOtpDto: VerifyOtpDto, deviceName?: string | null) {
    const identifier = verifyOtpDto.phoneNumber || verifyOtpDto.email;
    if (!identifier) {
      throw new BadRequestException('Vui lòng cung cấp email hoặc số điện thoại!');
    }

    if (this.otpService) {
      await this.otpService.verifyOtp(identifier, verifyOtpDto.otp);
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException('Dịch vụ OTP chưa sẵn sàng, vui lòng liên hệ quản trị viên!');
      }
      if (verifyOtpDto.otp !== '123456') {
        throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn! [MOCK]');
      }
    }

    let user;
    if (verifyOtpDto.phoneNumber) {
      user = await this.userService.findByPhoneNumber(verifyOtpDto.phoneNumber);
    } else if (verifyOtpDto.email) {
      user = await this.userService.findByEmail(verifyOtpDto.email);
    }

    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'Tài khoản không tồn tại!'
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Tài khoản của bạn đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quản trị viên!'
      });
    }
    
    if (user.isLoginLocked) {
      throw new UnauthorizedException({
        code: 'LOGIN_PERMANENTLY_LOCKED',
        message: 'Tài khoản đã bị khóa đăng nhập. Vui lòng khôi phục mật khẩu hoặc liên hệ quản trị viên!'
      });
    }

    if (this.loginSecurityService) {
      const lockTtl = await this.loginSecurityService.getTemporaryLockTtl(user.userId);
      if (lockTtl > 0) {
        throw new UnauthorizedException({
          code: 'LOGIN_TEMPORARILY_LOCKED',
          message: \`Tài khoản tạm thời bị khóa. Vui lòng thử lại sau \${lockTtl} giây.\`,
          retryAfterSeconds: lockTtl
        });
      }
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
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload);
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
    });

    const session = new UserSession();
    session.userId = user.userId;
    session.refreshToken = refreshToken;
    session.deviceInfo = deviceName || 'Unknown Device';
    session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.userSessionRepository.save(session);
    await this.loginSecurityService?.clear(user.userId);

    return {
      userId: user.userId,
      fullName: user.fullName,
      accessToken,
      refreshToken,
    };
  }
`;
  serviceCode = serviceCode.replace(/}\s*$/, loginWithOtpFunc + '\n}\n');
  fs.writeFileSync('src/modules/auth/auth.service.ts', serviceCode, 'utf8');
  console.log('Added loginWithOtp to auth.service.ts');
} else {
  console.log('loginWithOtp already exists in auth.service.ts');
}

let controllerCode = fs.readFileSync('src/modules/auth/auth.controller.ts', 'utf8');
if (!controllerCode.includes('@Post(\'login-with-otp\')')) {
  const loginWithOtpControllerFunc = `
  @Public()
  @Post('login-with-otp')
  async loginWithOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    userId: string;
    fullName: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const identifier = verifyOtpDto.phoneNumber || verifyOtpDto.email;
    await this.applyRateLimit(
      getOtpVerifyPhoneKey(identifier),
      RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_LIMIT,
      RATE_LIMIT_CONFIG.OTP_VERIFY.PHONE_WINDOW,
    );
    const result = await this.authService.loginWithOtp(verifyOtpDto, userAgent);
    return result;
  }
`;
  controllerCode = controllerCode.replace(/}\s*$/, loginWithOtpControllerFunc + '\n}\n');
  fs.writeFileSync('src/modules/auth/auth.controller.ts', controllerCode, 'utf8');
  console.log('Added login-with-otp to auth.controller.ts');
} else {
  console.log('login-with-otp already exists in auth.controller.ts');
}
