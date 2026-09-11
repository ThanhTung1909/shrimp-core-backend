import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiPrediction } from './entities/ai-prediction.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([AiPrediction])],
  exports: [TypeOrmModule],
})
export class PredictionsModule {}
