import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pond } from './entities/pond.entity.js';
import { ThresholdConfig } from './entities/threshold-config.entity.js';
import { ManualTestLog } from './entities/manual-test-log.entity.js';
import { PondsController } from './ponds.controller.js';
import { PondsService } from './ponds.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Pond, ThresholdConfig, ManualTestLog])],
  controllers: [PondsController],
  providers: [PondsService],
  exports: [TypeOrmModule],
})
export class PondsModule {}