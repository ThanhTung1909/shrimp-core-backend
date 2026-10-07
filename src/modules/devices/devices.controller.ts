import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DevicesService, PaginatedDevicesResult } from './devices.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { AssignPondDto } from './dto/assign-pond.dto.js';
import { UpdateDeviceStatusDto } from './dto/update-device-status.dto.js';
import { FindDevicesQueryDto } from './dto/find-devices-query.dto.js';
import { Device } from './entities/device.entity.js';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Devices - Quản Lý Thiết Bị IoT')
@ApiBearerAuth('JWT-auth')
@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Quản trị viên đăng ký thiết bị IoT mới (Địa chỉ MAC)' })
  @ApiResponse({ status: 201, description: 'Đăng ký thiết bị thành công' })
  @ApiResponse({ status: 409, description: 'Địa chỉ MAC đã được đăng ký' })
  async createDevice(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() createDeviceDto: CreateDeviceDto,
  ): Promise<{ message: string; data: Device }> {
    const device = await this.devicesService.createDevice(
      createDeviceDto,
      userId,
      role,
    );
    return {
      message: 'Đăng ký thiết bị thành công!',
      data: device,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thiết bị IoT (Phân trang, Tìm kiếm MAC/tên, Lọc theo pondId, status)' })
  @ApiResponse({ status: 200, description: 'Danh sách thiết bị phân trang' })
  async findAllDevices(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Query() query: FindDevicesQueryDto,
  ): Promise<PaginatedDevicesResult> {
    return await this.devicesService.findAllDevices(query, userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết thiết bị IoT theo UUID' })
  @ApiResponse({ status: 200, description: 'Chi tiết thiết bị IoT' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy thiết bị' })
  async findDeviceById(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<Device> {
    return await this.devicesService.findDeviceById(deviceId, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Quản trị viên cập nhật thông tin/firmware thiết bị' })
  @ApiResponse({ status: 200, description: 'Cập nhật thiết bị thành công' })
  async updateDevice(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() updateDeviceDto: UpdateDeviceDto,
  ): Promise<{ message: string; data: Device }> {
    const device = await this.devicesService.updateDevice(
      deviceId,
      updateDeviceDto,
      userId,
      role,
    );
    return {
      message: 'Cập nhật thiết bị thành công!',
      data: device,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/pond')
  @ApiOperation({ summary: 'Gán hoặc gỡ thiết bị IoT khỏi ao nuôi' })
  @ApiResponse({ status: 200, description: 'Gán/gỡ thiết bị thành công' })
  async assignToPond(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() assignPondDto: AssignPondDto,
  ): Promise<{ message: string; data: Device }> {
    const device = await this.devicesService.assignToPond(
      deviceId,
      assignPondDto,
      userId,
      role,
    );
    return {
      message: assignPondDto.pondId
        ? 'Gắn thiết bị vào ao nuôi thành công!'
        : 'Tháo thiết bị khỏi ao nuôi thành công!',
      data: device,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái hoạt động của thiết bị (ONLINE, OFFLINE, MAINTENANCE)' })
  @ApiResponse({ status: 200, description: 'Cập nhật trạng thái thành công' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() updateDeviceStatusDto: UpdateDeviceStatusDto,
  ): Promise<{ message: string; data: Device }> {
    const device = await this.devicesService.updateStatus(
      deviceId,
      updateDeviceStatusDto,
      userId,
      role,
    );
    return {
      message: `Cập nhật trạng thái thiết bị sang ${updateDeviceStatusDto.status} thành công!`,
      data: device,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete(':id')
  @ApiOperation({ summary: 'Quản trị viên xóa thiết bị IoT' })
  @ApiResponse({ status: 200, description: 'Xóa thiết bị thành công' })
  async deleteDevice(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ message: string }> {
    return await this.devicesService.deleteDevice(deviceId, userId, role);
  }
}

