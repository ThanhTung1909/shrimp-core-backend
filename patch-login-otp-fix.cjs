const fs = require('fs');

let serviceCode = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

// Ensure we don't duplicate
if (!serviceCode.includes('async loginWithOtp(')) {
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

    const tokenFamily = crypto.randomUUID();
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
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as any,
    });

    const decoded = this.jwtService.decode(refreshToken) as any;
    if (!decoded || !decoded.exp) {
      throw new UnauthorizedException('Refresh token không hợp lệ!');
    }

    const expiresAt = new Date(decoded.exp * 1000);
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const session = this.userSessionRepository.create({
      userId: user.userId,
      refreshTokenHash,
      tokenFamily,
      deviceName: deviceName || null,
      expiresAt,
    });

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
  
  // Fix the previously removed MOCK bracket if it got reverted
  serviceCode = serviceCode.replace(
    /'Mã OTP không chính xác hoặc đã hết hạn!'/g,
    "'Mã OTP không chính xác hoặc đã hết hạn! [MOCK]'"
  );

  fs.writeFileSync('src/modules/auth/auth.service.ts', serviceCode, 'utf8');
  console.log('Added loginWithOtp to auth.service.ts');
}

