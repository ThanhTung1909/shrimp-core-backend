import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreateFarmDto, FindFarmsQueryDto, UpdateFarmDto } from './dto/farm.dto.js';
import { FarmsService } from './farms.service.js';

@ApiTags('Farms')
@ApiBearerAuth('JWT-auth')
@Controller('farms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FarmsController {
  constructor(private readonly service: FarmsService) {}

  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Chỉ Quản trị viên (ADMIN) mới có quyền tạo trại nuôi mới' })
  @ApiResponse({ status: 201, description: 'Tạo trại nuôi thành công' })
  create(@Body() dto: CreateFarmDto, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) {
    return this.service.create(dto, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách trại nuôi (Admin xem tất cả, Manager chỉ xem trại do mình quản lý)' })
  findAll(@Query() query: FindFarmsQueryDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) {
    return this.service.findAll(query, id, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get(':farmId/ponds')
  @ApiOperation({ summary: 'Lấy danh sách ao nuôi trực thuộc trại' })
  ponds(@Param('farmId', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) {
    return this.service.findPonds(id, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get(':farmId')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết trại nuôi' })
  findOne(@Param('farmId', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) {
    return this.service.findOne(id, userId, role);
  }

  @Roles(Role.ADMIN)
  @Patch(':farmId')
  @ApiOperation({ summary: 'Chỉ Quản trị viên (ADMIN) mới có quyền chỉnh sửa trại nuôi' })
  update(
    @Param('farmId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFarmDto,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.service.update(id, dto, userId, role);
  }

  @Roles(Role.ADMIN)
  @Patch(':farmId/assign-manager')
  @ApiOperation({ summary: 'Chỉ Quản trị viên (ADMIN) mới có quyền phân công Quản lý phụ trách trại nuôi' })
  assignManager(
    @Param('farmId', ParseUUIDPipe) id: string,
    @Body('managerId', ParseUUIDPipe) managerId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.service.assignManager(id, managerId, userId, role);
  }

  @Roles(Role.ADMIN)
  @Patch(':farmId/revoke-manager')
  @ApiOperation({ summary: 'ADMIN thu hồi phân công Manager khỏi trại nuôi' })
  @ApiResponse({ status: 200, description: 'Thu hồi phân công Manager thành công' })
  revokeManager(
    @Param('farmId', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.service.revokeManager(id, userId, role);
  }

  @Roles(Role.ADMIN)
  @Delete(':farmId')
  @ApiOperation({ summary: 'Chỉ Quản trị viên (ADMIN) mới có quyền xóa trại nuôi' })
  remove(@Param('farmId', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) {
    return this.service.remove(id, userId, role);
  }
}
