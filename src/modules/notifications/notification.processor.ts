import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUE_NOTIFICATIONS,
  NOTIFICATION_JOBS,
  type SendEmailJobData,
  type SendSmsJobData,
  type SendFcmJobData,
} from '../../common/queues/queue.constants.js';
import { EmailService } from '../email/email.service.js';
import { EsmsService } from '../../common/esms/esms.service.js';
import { FcmService } from './fcm.service.js';

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationQueueProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly esmsService: EsmsService,
    private readonly fcmService: FcmService,
  ) {
    super();
  }

  /**
   * Xử lý các job trong Queue notifications:
   * 1. send-email: Gửi email mật khẩu khởi tạo hoặc email thông báo
   * 2. send-sms: Gửi mã OTP xác thực qua eSMS Gateway
   * 3. send-fcm: Gửi push notification tới thiết bị di động
   */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(
      `[Worker] Bắt đầu xử lý job ID: ${job.id}, Name: ${job.name}, Lần thử: ${job.attemptsMade + 1}/${job.opts.attempts || 3}`,
    );

    switch (job.name) {
      case NOTIFICATION_JOBS.SEND_EMAIL: {
        const data = job.data as SendEmailJobData;
        return await this.handleSendEmail(data);
      }

      case NOTIFICATION_JOBS.SEND_SMS: {
        const data = job.data as SendSmsJobData;
        return await this.handleSendSms(data);
      }

      case NOTIFICATION_JOBS.SEND_FCM: {
        const data = job.data as SendFcmJobData;
        return await this.handleSendFcm(data);
      }

      default:
        this.logger.warn(`[Worker] Bỏ qua job không xác định: ${job.name}`);
        return null;
    }
  }

  private async handleSendEmail(data: SendEmailJobData): Promise<void> {
    if (data.type === 'initial-password') {
      if (!data.email || !data.fullName || !data.phoneNumber || !data.password) {
        throw new Error('Dữ liệu gửi email mật khẩu ban đầu không đầy đủ');
      }
      await this.emailService.sendInitialPassword(
        data.email,
        data.fullName,
        data.phoneNumber,
        data.password,
      );
      this.logger.log('[Worker] SMTP accepted initial account email');
    } else {
      if (typeof this.emailService.sendNotificationEmail === 'function' && data.subject && data.text) {
        await this.emailService.sendNotificationEmail(data.email, data.subject, data.text);
      }
      this.logger.log('[Worker] SMTP accepted notification email');
    }
  }

  private async handleSendSms(data: SendSmsJobData): Promise<any> {
    if (!data.phone || !data.otp) {
      throw new Error('Thiếu số điện thoại hoặc mã OTP để gửi SMS');
    }
    const result = await this.esmsService.sendSMS(data.phone, data.otp);
    this.logger.log('[Worker] eSMS accepted OTP delivery request');
    return result;
  }

  private async handleSendFcm(data: SendFcmJobData): Promise<any> {
    if (!data.fcmToken) {
      this.logger.warn(`[Worker] Bỏ qua gửi FCM: Token thiết bị không tồn tại`);
      return null;
    }
    const result = await this.fcmService.sendToTokens(
      [data.fcmToken],
      data.title,
      data.body,
      data.data,
    );
    this.logger.log(`[Worker] Firebase accepted ${result.successCount} FCM request(s)`);
    return result;
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`[Worker] Job ${job.id} (${job.name}) hoàn thành thành công.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[Worker Failed] Job ${job.id} (${job.name}) thất bại lần ${job.attemptsMade}/${job.opts.attempts || 3}. Lỗi: ${error.message}`,
    );
  }
}
