import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto.js';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { SendOtpDto } from './dto/send-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  //Hàm gửi OTP (Mock Send OTP)
  async sendOtp(sendOtpDto: SendOtpDto) {
    const existingUser = await this.userService.findByPhoneNumber(sendOtpDto.phoneNumber);
    if (existingUser) {
      throw new ConflictException('Số điện thoại này đã được đăng ký trong hệ thống!');
    }

    // Giả định mã OTP cố định hoặc ngẫu nhiên 6 chữ số
    const mockOtp = '123456';
    return {
      message: 'Mã OTP đã được gửi thành công!',
      phoneNumber: sendOtpDto.phoneNumber,
      otp: mockOtp, // Trả về OTP để phục vụ việc test/dev dễ dàng
      expiresIn: '5 phút',
    };
  }

  //Hàm giả định xác thực OTP (Mock Verify OTP)
  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const MOCK_OTP = '123456';

    if (verifyOtpDto.otp !== MOCK_OTP) {
      throw new BadRequestException('Mã OTP không chính xác hoặc đã hết hạn!');
    }

    return {
      message: 'Xác thực OTP thành công!',
      phoneNumber: verifyOtpDto.phoneNumber,
      isValid: true,
    };
  }

  //Hàm đăng ký tài khoản
  async register(registerDto: RegisterDto) {
    const existingUser = await this.userService.findByPhoneNumber(registerDto.phoneNumber);
    if (existingUser) {
      throw new ConflictException('Số điện thoại này đã được đăng ký!');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 10);
    const user = await this.userService.createUser({
      fullName: registerDto.fullName,
      phoneNumber: registerDto.phoneNumber,
      passwordHash,
      role: registerDto.role,
    });

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
    };

    const accessToken = await this.jwtService.signAsync(accessPayload);
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      expiresIn: '7d',
    });

    return {
      message: 'Đăng ký tài khoản thành công!',
      userId: user.userId,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      tokenVersion: user.tokenVersion,
      accessToken,
      refreshToken,
    };
  }

  //Hàm đăng nhập
  async login(loginDto: LoginDto) {
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
    };
    const accessToken = await this.jwtService.signAsync(accessPayload);

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      expiresIn: '7d',
    });
    return {
      userId: user.userId,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      tokenVersion: user.tokenVersion,
      accessToken,
      refreshToken,
    };
  }

  //Hàm làm mới token
  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken);
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
      const newAccessToken = await this.jwtService.signAsync({
        sub: user.userId,
        tokenVersion: user.tokenVersion,
        role: user.role,
        type: 'access',
      });
      return {
        accessToken: newAccessToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Refresh token không hợp lệ!');
    }
  }

  //Hàm thay đổi mật khẩu
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
    const newPasswordHash = await bcrypt.hash(changePasswordDto.newPassword, 10);
    await this.userService.upatePassword(userId, newPasswordHash);
    await this.userService.incrementTokenVersion(userId);

    const updateUser = await this.userService.findById(userId);
    if (!updateUser) {
      throw new UnauthorizedException("Người dùng không tồn tại!")
    }

    //Cấp lại access token cho thiet bi hien tai
    const accessToken = await this.jwtService.signAsync({
      sub: updateUser.userId,
      tokenVersion: updateUser.tokenVersion,
      role: updateUser.role,
      type: 'access',
    });

    //Cấp lại refresh token
    const refreshToken = await this.jwtService.signAsync({
      sub: updateUser.userId,
      tokenVersion: updateUser.tokenVersion,
      role: updateUser.role,
      type: 'refresh',
    }, {
      expiresIn: '7d',
    });

    return {
      message: 'Thay đổi mật khẩu thành công!',
      userId: updateUser.userId,
      fullName: updateUser.fullName,
      phoneNumber: updateUser.phoneNumber,
      role: updateUser.role,
      tokenVersion: updateUser.tokenVersion,
      accessToken,
      refreshToken,
    };
  }
}
