import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pond } from './entities/pond.entity.js';
import { ThresholdConfig } from './entities/threshold-config.entity.js';
import { ManualTestLog } from './entities/manual-test-log.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Pond, ThresholdConfig, ManualTestLog])],
  exports: [TypeOrmModule],
})
export class PondsModule {}
