import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { AiRiskAlertReceipt } from './entities/ai-risk-alert-receipt.entity.js';
import { AiRiskAlertsService } from './ai-risk-alerts.service.js';
import { AiRiskNotificationOutboxWorker } from './ai-risk-notification-outbox.worker.js';
import { AiRiskRabbitMqConsumer } from './ai-risk-rabbitmq.consumer.js';
import { AiRiskNotificationOutbox } from './entities/ai-risk-notification-outbox.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([AiRiskAlertReceipt, AiRiskNotificationOutbox, Alert, Pond]), AlertsModule, NotificationsModule],
  providers: [AiRiskAlertsService, AiRiskRabbitMqConsumer, AiRiskNotificationOutboxWorker],
})
export class AiRiskAlertsModule {}
