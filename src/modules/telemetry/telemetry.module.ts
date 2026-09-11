import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryData } from './entities/telemetry-data.entity.js';
import { TelemetryService } from './telemetry.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([TelemetryData])],
  providers: [TelemetryService],
  exports: [TelemetryService, TypeOrmModule],
})
export class TelemetryModule {}
