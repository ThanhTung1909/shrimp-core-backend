import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryData } from './entities/telemetry-data.entity.js';
import { Device } from '../devices/entities/device.entity.js';
import { TelemetryService } from './telemetry.service.js';
import { TelemetryMqttService } from './telemetry-mqtt.service.js';
import { TelemetryController } from './telemetry.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([TelemetryData, Device])],
  controllers: [TelemetryController],
  providers: [TelemetryService, TelemetryMqttService],
  exports: [TelemetryService, TelemetryMqttService, TypeOrmModule],
})
export class TelemetryModule {}
