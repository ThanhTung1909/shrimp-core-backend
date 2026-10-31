import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NOTIFICATIONS } from '../../common/queues/queue.constants.js';
import { NotificationPreference } from './entities/notification-preference.entity.js';
import { NotificationToken } from './entities/notification-token.entity.js';
import { NotificationDelivery } from './entities/notification-delivery.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { EmailModule } from '../email/email.module.js';
import { EsmsModule } from '../../common/esms/esms.module.js';
import { RedisModule } from '../../common/redis/redis.module.js';
import { FcmService } from './fcm.service.js';
import { NotificationTokensService } from './notification-tokens.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationQueueService } from './notification-queue.service.js';
import { NotificationQueueProcessor } from './notification.processor.js';
import { AlertNotificationListener } from './alert-notification.listener.js';

@Module({
  imports: [
    ConfigModule,
    EmailModule,
    EsmsModule,
    RedisModule,
    BullModule.registerQueue({
      name: QUEUE_NOTIFICATIONS,
    }),
    TypeOrmModule.forFeature([
      NotificationPreference,
      NotificationToken,
      NotificationDelivery,
      Pond,
      User,
      Alert,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    FcmService,
    NotificationTokensService,
    NotificationPreferencesService,
    NotificationDispatcherService,
    NotificationQueueService,
    NotificationQueueProcessor,
    AlertNotificationListener,
  ],
  exports: [
    NotificationDispatcherService,
    NotificationPreferencesService,
    NotificationTokensService,
    FcmService,
    NotificationQueueService,
    BullModule,
    AlertNotificationListener,
  ],
})
export class NotificationsModule {}
