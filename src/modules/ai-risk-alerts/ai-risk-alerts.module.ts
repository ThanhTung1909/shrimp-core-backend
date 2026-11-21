import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { AiRiskAlertReceipt } from './entities/ai-risk-alert-receipt.entity.js';
import { AiRiskAlertsService } from './ai-risk-alerts.service.js';
import { AiRiskRabbitMqConsumer } from './ai-risk-rabbitmq.consumer.js';

@Module({
  imports: [TypeOrmModule.forFeature([AiRiskAlertReceipt, Alert, Pond]), AlertsModule],
  providers: [AiRiskAlertsService, AiRiskRabbitMqConsumer],
})
export class AiRiskAlertsModule {}
