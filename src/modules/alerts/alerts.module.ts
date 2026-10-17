import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './entities/alert.entity.js';
import { AiRecommendation } from './entities/ai-recommendation.entity.js';
import { AlertsService } from './alerts.service.js';
import { AlertsController } from './alerts.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Alert, AiRecommendation])],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [TypeOrmModule, AlertsService],
})
export class AlertsModule {}
