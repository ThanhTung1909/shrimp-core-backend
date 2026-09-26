import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { User } from './entities/user.entity.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto.js';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { FindUsersQueryDto } from './dto/find-users-query.dto.js';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // API 1: Người dùng tự cập nhật thông tin cá nhân (Profile)
  @Patch('profile')
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<{
    message: string;
    user: Omit<User, 'passwordHash'>;
  }> {
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
  async updateFcmToken(
    @CurrentUser('userId') userId: string,
    @Body() updateFcmTokenDto: UpdateFcmTokenDto,
  ): Promise<{ message: string }> {
    return this.usersService.updateFcmToken(
      userId,
      updateFcmTokenDto.fcmToken,
    );
  }

  // API 3: Quản trị viên lấy danh sách tất cả người dùng
  @Get()
  @Roles(Role.MANAGER)
  async getAllUsers(@Query() query: FindUsersQueryDto): Promise<{
    data: Omit<User, 'passwordHash'>[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return this.usersService.findAll(query);
  }

  // API 4: Quản trị viên tạo người dùng mới
  @Post()
  @Roles(Role.MANAGER)
  async createUser(@Body() createUserDto: CreateUserDto): Promise<{
    message: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const newUser = await this.usersService.createUserByAdmin(createUserDto);
    return {
      message: 'Tạo tài khoản người dùng thành công!',
      user: newUser,
    };
  }

  // API 5: Lấy thông tin chi tiết người dùng theo ID
  @Get(':id')
  async getUserById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') currentUserId: string,
    @CurrentUser('role') role: Role,
  ): Promise<Omit<User, 'passwordHash'>> {
    if (role !== Role.MANAGER && currentUserId !== id) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập thông tin của người dùng khác!',
      );
    }
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }
    return this.usersService.sanitizeUser(user);
  }

  // API 6: Quản trị viên cập nhật thông tin/trạng thái tài khoản người dùng
  @Patch(':id')
  @Roles(Role.MANAGER)
  async adminUpdateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() adminUpdateUserDto: AdminUpdateUserDto,
  ): Promise<{
    message: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const updatedUser = await this.usersService.adminUpdateUser(
      id,
      adminUpdateUserDto,
    );
    return {
      message: 'Cập nhật tài khoản người dùng thành công!',
      user: updatedUser,
    };
  }

  // API 7: Quản trị viên xóa người dùng
  @Delete(':id')
  @Roles(Role.MANAGER)
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.usersService.deleteUser(id);
  }
}
