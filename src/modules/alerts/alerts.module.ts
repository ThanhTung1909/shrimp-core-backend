import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './entities/alert.entity.js';
import { AiRecommendation } from './entities/ai-recommendation.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Alert, AiRecommendation])],
  exports: [TypeOrmModule],
})
export class AlertsModule {}
