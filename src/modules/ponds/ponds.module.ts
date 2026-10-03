import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pond } from './entities/pond.entity.js';
import { ThresholdConfig } from './entities/threshold-config.entity.js';
import { ManualTestLog } from './entities/manual-test-log.entity.js';
import { PondsController } from './ponds.controller.js';
import { PondsService } from './ponds.service.js';
import { User } from '../users/entities/user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Pond, ThresholdConfig, ManualTestLog, User])],
  controllers: [PondsController],
  providers: [PondsService],
  exports: [TypeOrmModule],
})
export class PondsModule {}