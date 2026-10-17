import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NOTIFICATIONS } from '../../common/queues/queue.constants.js';
import { EmailModule } from '../email/email.module.js';
import { EsmsModule } from '../../common/esms/esms.module.js';
import { UsersModule } from '../users/users.module.js';
import { RedisModule } from '../../common/redis/redis.module.js';
import { NotificationQueueService } from './notification-queue.service.js';
import { NotificationQueueProcessor } from './notification.processor.js';
import { AlertNotificationListener } from './alert-notification.listener.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NOTIFICATIONS,
    }),
    EmailModule,
    EsmsModule,
    UsersModule,
    RedisModule,
  ],
  providers: [
    NotificationQueueService,
    NotificationQueueProcessor,
    AlertNotificationListener,
  ],
  exports: [
    NotificationQueueService,
    BullModule,
    AlertNotificationListener,
  ],
})
export class NotificationsModule {}
