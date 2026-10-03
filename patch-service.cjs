const fs = require('fs');
let data = fs.readFileSync('src/modules/auth/auth.service.ts', 'utf8');

const resetPasswordCode = `
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const identifier = resetPasswordDto.email || resetPasswordDto.phoneNumber;
    if (!identifier) {
      throw new BadRequestException('Vui lòng cung cấp email hoặc số điện thoại!');
    }

    if (this.otpService) {
      // Validate OTP first
      await this.otpService.verifyOtp(identifier, resetPasswordDto.otp);
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException('Dịch vụ OTP chưa sẵn sàng!');
      }
      if (resetPasswordDto.otp !== '123456') {
        throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn!');
      }
    }

    let user;
    if (resetPasswordDto.email) {
      user = await this.userService.findByEmail(resetPasswordDto.email);
    } else {
      user = await this.userService.findByPhoneNumber(resetPasswordDto.phoneNumber!);
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị khóa!');
    }

    const newPasswordHash = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    await this.dataSource.transaction(async (manager) => {
      // 1. Update password
      await this.userService.updatePassword(user.userId, newPasswordHash, manager);

      // 2. Increment token version to invalidate old JWTs (if relying on version)
      await this.userService.incrementTokenVersion(user.userId, manager);

      // 3. Revoke all sessions
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
    });

    return {
      message: 'Đặt lại mật khẩu thành công!',
    };
  }
}
`;

data = data.replace(/}\s*$/, resetPasswordCode);

fs.writeFileSync('src/modules/auth/auth.service.ts', data, 'utf8');
console.log("Service Updated.");
