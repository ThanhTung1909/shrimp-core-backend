import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NOTIFICATIONS } from '../../common/queues/queue.constants.js';
import { EmailModule } from '../email/email.module.js';
import { EsmsModule } from '../../common/esms/esms.module.js';
import { NotificationQueueService } from './notification-queue.service.js';
import { NotificationQueueProcessor } from './notification.processor.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NOTIFICATIONS,
    }),
    EmailModule,
    EsmsModule,
  ],
  providers: [
    NotificationQueueService,
    NotificationQueueProcessor,
  ],
  exports: [
    NotificationQueueService,
    BullModule,
  ],
})
export class NotificationsModule {}
