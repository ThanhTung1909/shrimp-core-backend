import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Farm } from '../farms/entities/farm.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { PondFarmerAssignment } from '../ponds/entities/pond-farmer-assignment.entity.js';
import { CropsController } from './crops.controller.js';
import { CropsService } from './crops.service.js';
import { HarvestLog } from './entities/harvest-log.entity.js';
import { ShrimpBatch } from './entities/shrimp-batch.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([ShrimpBatch, HarvestLog, Pond, PondFarmerAssignment, Farm])],
  controllers: [CropsController],
  providers: [CropsService],
  exports: [CropsService],
})
export class CropsModule {}
