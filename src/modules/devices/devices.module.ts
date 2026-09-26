import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Device, Pond])],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [TypeOrmModule],
})
export class DevicesModule {}