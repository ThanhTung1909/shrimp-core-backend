import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { Farm } from '../farms/entities/farm.entity.js';
import { PondFarmerAssignment } from '../ponds/entities/pond-farmer-assignment.entity.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, Pond, Farm, PondFarmerAssignment, Alert]),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService, TypeOrmModule],
})
export class DevicesModule {}
