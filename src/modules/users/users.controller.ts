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
import { UnlockUserDto } from './dto/unlock-user.dto.js';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Users - Quản Lý Người Dùng')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // API 1: Người dùng tự cập nhật thông tin cá nhân (Profile)
  @Patch('profile')
  @ApiOperation({ summary: 'Người dùng tự cập nhật thông tin cá nhân (Profile)' })
  @ApiResponse({ status: 200, description: 'Cập nhật thông tin thành công' })
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
  @ApiOperation({ summary: 'Cập nhật FCM Token để nhận thông báo đẩy Mobile' })
  @ApiResponse({ status: 200, description: 'Cập nhật FCM Token thành công' })
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
  @ApiOperation({ summary: 'Quản trị viên lấy danh sách người dùng (Có phân trang & Tìm kiếm)' })
  @ApiResponse({ status: 200, description: 'Danh sách người dùng phân trang' })
  @ApiResponse({ status: 403, description: 'Không có quyền truy cập' })
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
  @ApiOperation({ summary: 'Quản trị viên khởi tạo tài khoản người dùng mới' })
  @ApiResponse({ status: 201, description: 'Tạo người dùng thành công' })
  @ApiResponse({ status: 409, description: 'Số điện thoại đã tồn tại' })
  async createUser(@Body() createUserDto: CreateUserDto, @CurrentUser('userId') actorId: string): Promise<{
    message: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const newUser = await this.usersService.createUserByAdmin(createUserDto, actorId);
    return {
      message: 'Tạo tài khoản người dùng thành công!',
      user: newUser,
    };
  }

  // API 5: Lấy thông tin chi tiết người dùng theo ID
  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết người dùng theo UUID' })
  @ApiResponse({ status: 200, description: 'Chi tiết người dùng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy người dùng' })
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
  @Patch(':id/unlock')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Mở khóa do đăng nhập sai; không mở khóa quản trị hoặc chính mình' })
  @ApiResponse({ status: 200, description: 'Mở khóa thành công' })
  @ApiResponse({ status: 403, description: 'Không có quyền mở khóa tài khoản này' })
  async unlockUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @Body() dto: UnlockUserDto,
  ): Promise<{ message: string; userId: string }> {
    return this.usersService.unlockUser(actorId, id, dto.reason);
  }

  @Patch(':id')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Quản trị viên cập nhật thông tin hoặc trạng thái tài khoản người dùng' })
  @ApiResponse({ status: 200, description: 'Cập nhật tài khoản thành công' })
  async adminUpdateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() adminUpdateUserDto: AdminUpdateUserDto,
    @CurrentUser('userId') actorId: string,
  ): Promise<{
    message: string;
    user: Omit<User, 'passwordHash'>;
  }> {
    const updatedUser = await this.usersService.adminUpdateUser(
      id,
      adminUpdateUserDto,
      actorId,
    );
    return {
      message: 'Cập nhật tài khoản người dùng thành công!',
      user: updatedUser,
    };
  }

  // API 7: Quản trị viên xóa người dùng
  @Delete(':id')
  @Roles(Role.MANAGER)
  @ApiOperation({ summary: 'Quản trị viên xóa tài khoản người dùng' })
  @ApiResponse({ status: 200, description: 'Xóa tài khoản người dùng thành công' })
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ): Promise<{ message: string }> {
    return this.usersService.deleteUser(id, actorId);
  }
}
