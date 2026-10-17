import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, type JobsOptions } from 'bullmq';
import {
  QUEUE_NOTIFICATIONS,
  NOTIFICATION_JOBS,
  type SendEmailJobData,
  type SendSmsJobData,
  type SendFcmJobData,
} from '../../common/queues/queue.constants.js';

@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);

  private readonly defaultJobOptions: JobsOptions = {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };

  constructor(
    @InjectQueue(QUEUE_NOTIFICATIONS)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Đẩy job gửi Email vào hàng đợi BullMQ
   */
  async addSendEmailJob(data: SendEmailJobData, customOpts?: JobsOptions) {
    this.logger.log(`[Queue] Đẩy job gửi email tới ${data.email} vào queue ${QUEUE_NOTIFICATIONS}`);
    return this.notificationQueue.add(
      NOTIFICATION_JOBS.SEND_EMAIL,
      data,
      {
        ...this.defaultJobOptions,
        ...customOpts,
      },
    );
  }

  /**
   * Đẩy job gửi SMS OTP vào hàng đợi BullMQ
   */
  async addSendSmsJob(phone: string, otp: string, customOpts?: JobsOptions) {
    this.logger.log(`[Queue] Đẩy job gửi SMS tới ${phone} vào queue ${QUEUE_NOTIFICATIONS}`);
    const data: SendSmsJobData = { phone, otp };
    return this.notificationQueue.add(
      NOTIFICATION_JOBS.SEND_SMS,
      data,
      {
        ...this.defaultJobOptions,
        ...customOpts,
      },
    );
  }

  /**
   * Đẩy job gửi Push Notification (FCM) vào hàng đợi BullMQ
   */
  async addSendFcmJob(data: SendFcmJobData, customOpts?: JobsOptions) {
    this.logger.log(`[Queue] Đẩy job gửi FCM title "${data.title}" vào queue ${QUEUE_NOTIFICATIONS}`);
    return this.notificationQueue.add(
      NOTIFICATION_JOBS.SEND_FCM,
      data,
      {
        ...this.defaultJobOptions,
        ...customOpts,
      },
    );
  }
}
