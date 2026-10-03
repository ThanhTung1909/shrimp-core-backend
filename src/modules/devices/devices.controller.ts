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

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
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
  async findAllDevices(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Query() query: FindDevicesQueryDto,
  ): Promise<PaginatedDevicesResult> {
    return await this.devicesService.findAllDevices(query, userId, role);
  }

  @Get(':id')
  async findDeviceById(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<Device> {
    return await this.devicesService.findDeviceById(deviceId, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id')
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
  async deleteDevice(
    @Param('id', ParseUUIDPipe) deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<{ message: string }> {
    return await this.devicesService.deleteDevice(deviceId, userId, role);
  }
}

