import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { FindDevicesQueryDto } from './dto/find-devices-query.dto.js';

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  async createDevice(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() createDeviceDto: CreateDeviceDto,
  ) {
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
  ) {
    return this.devicesService.findAllDevices(query, userId, role);
  }

  @Get(':id')
  async findDeviceById(
    @Param('id') deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.devicesService.findDeviceById(deviceId, userId, role);
  }

  @Patch(':id')
  async updateDevice(
    @Param('id') deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() updateDeviceDto: UpdateDeviceDto,
  ) {
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

  @Delete(':id')
  async deleteDevice(
    @Param('id') deviceId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.devicesService.deleteDevice(deviceId, userId, role);
  }
}
