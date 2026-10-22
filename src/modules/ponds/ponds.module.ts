import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pond } from './entities/pond.entity.js';
import { ThresholdConfig } from './entities/threshold-config.entity.js';
import { ManualTestLog } from './entities/manual-test-log.entity.js';
import { PondsController } from './ponds.controller.js';
import { PondsService } from './ponds.service.js';
import { Farm } from '../farms/entities/farm.entity.js';
import { User } from '../users/entities/user.entity.js';
import { PondFarmerAssignment } from './entities/pond-farmer-assignment.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Pond, ThresholdConfig, ManualTestLog, Farm, User, PondFarmerAssignment])],
  controllers: [PondsController],
  providers: [PondsService],
  exports: [PondsService, TypeOrmModule],
})
export class PondsModule {}
