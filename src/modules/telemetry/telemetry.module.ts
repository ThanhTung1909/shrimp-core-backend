import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryData } from './entities/telemetry-data.entity.js';
import { Device } from '../devices/entities/device.entity.js';
import { TelemetryService } from './telemetry.service.js';
import { TelemetryMqttService } from './telemetry-mqtt.service.js';
import { TelemetryController } from './telemetry.controller.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { DeviceHealthService } from './device-health.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([TelemetryData, Device, Alert])],
  controllers: [TelemetryController],
  providers: [TelemetryService, TelemetryMqttService, DeviceHealthService],
  exports: [TelemetryService, TelemetryMqttService, TypeOrmModule],
})
export class TelemetryModule {}
