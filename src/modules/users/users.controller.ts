import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto.js';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // API 1: Người dùng tự cập nhật thông tin cá nhân (Profile)
  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    const updatedUser = await this.usersService.updateProfile(
      userId,
      updateProfileDto,
    );
    return {
      message: 'Cập nhật thông tin cá nhân thành công!',
      user: updatedUser,
    };
  }

  // API 2: Cập nhật FCM Token nhận thông báo
  @Patch('fcm-token')
  @UseGuards(JwtAuthGuard)
  async updateFcmToken(
    @CurrentUser('userId') userId: string,
    @Body() updateFcmTokenDto: UpdateFcmTokenDto,
  ) {
    return this.usersService.updateFcmToken(
      userId,
      updateFcmTokenDto.fcmToken,
    );
  }

  // API 3: Lấy thông tin chi tiết người dùng theo ID
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getUserById(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }
    return this.usersService.sanitizeUser(user);
  }

  // API 4: Quản trị viên cập nhật thông tin/trạng thái tài khoản người dùng
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async adminUpdateUser(
    @Param('id') id: string,
    @Body() adminUpdateUserDto: AdminUpdateUserDto,
  ) {
    const updatedUser = await this.usersService.adminUpdateUser(
      id,
      adminUpdateUserDto,
    );
    return {
      message: 'Cập nhật tài khoản người dùng thành công!',
      user: updatedUser,
    };
  }
}
