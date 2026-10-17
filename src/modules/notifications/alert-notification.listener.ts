import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service.js';
import { UsersService } from '../users/users.service.js';
import { NotificationQueueService } from './notification-queue.service.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import type { Redis } from 'ioredis';

export interface AlertTriggeredEventPayload {
  pondId?: string | null;
  userId?: string | null;
  alert: {
    alertId?: string;
    pondId?: string;
    deviceId?: string;
    metricName?: string;
    triggeredValue?: number;
    alertLevel?: AlertLevel;
    message?: string;
    createdAt?: string | Date;
  };
}

@Injectable()
export class AlertNotificationListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertNotificationListener.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly usersService: UsersService,
    private readonly notificationQueueService: NotificationQueueService,
  ) {}

  onModuleInit() {
    this.setupRedisSubscriber();
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
        this.logger.log('[Alert Listener] Đã ngắt kết nối subscriber an toàn.');
      } catch (err: any) {
        this.logger.warn(`[Alert Listener] Lỗi ngắt kết nối: ${err.message}`);
      }
    }
  }

  private setupRedisSubscriber() {
    try {
      const mainClient = this.redisService.getClient();
      if (!mainClient) {
        this.logger.warn('[Alert Listener] Redis client chưa sẵn sàng để subscribe kênh alert:triggered.');
        return;
      }

      this.subscriber = mainClient.duplicate();

      this.subscriber.subscribe('alert:triggered', (err, count) => {
        if (err) {
          this.logger.error(`[Alert Listener] Không thể subscribe kênh alert:triggered: ${err.message}`);
        } else {
          this.logger.log(`[Alert Listener] Đã subscribe thành công kênh alert:triggered (${count} channels).`);
        }
      });

      this.subscriber.on('message', async (channel, message) => {
        if (channel === 'alert:triggered') {
          await this.handleAlertMessage(message);
        }
      });
    } catch (err: any) {
      this.logger.error(`[Alert Listener Exception] Lỗi khởi tạo subscriber: ${err.message}`);
    }
  }

  async handleAlertMessage(rawMessage: string): Promise<void> {
    try {
      const payload = JSON.parse(rawMessage) as AlertTriggeredEventPayload;
      const { pondId, userId, alert } = payload;

      if (!alert) return;

      this.logger.log(
        `[Alert Listener] Nhận sự kiện cảnh báo ao ${pondId || alert.pondId}: [${alert.alertLevel || AlertLevel.WARNING}] ${alert.message}`,
      );

      if (!userId) {
        this.logger.debug?.('[Alert Listener] Cảnh báo không có userId chủ sở hữu, bỏ qua dispatch notification.');
        return;
      }

      const user = await this.usersService.findById(userId);
      if (!user) {
        this.logger.warn(`[Alert Listener] Không tìm thấy thông tin user có ID: ${userId}`);
        return;
      }

      const alertTitle =
        alert.alertLevel === AlertLevel.CRITICAL
          ? `[BÁO ĐỘNG ĐỎ] Nguy cấp ao nuôi ${pondId || ''}`
          : `[CẢNH BÁO] Biến động chỉ số ao nuôi ${pondId || ''}`;

      const alertBody = alert.message || 'Chỉ số môi trường vượt ngưỡng an toàn cho phép!';

      // 1. Luôn ưu tiên Push Notification qua FCM nếu người dùng đã đăng ký thiết bị di động
      if (user.fcmToken) {
        await this.notificationQueueService.addSendFcmJob(
          {
            fcmToken: user.fcmToken,
            title: alertTitle,
            body: alertBody,
            data: {
              alertId: alert.alertId || '',
              pondId: pondId || '',
              alertLevel: alert.alertLevel || AlertLevel.WARNING,
            },
          },
          { priority: 1, attempts: 3 },
        );
      }

      // 2. Nếu cảnh báo ở cấp độ CRITICAL: Bắn SMS khẩn cấp tới số điện thoại chủ ao
      if (alert.alertLevel === AlertLevel.CRITICAL && user.phoneNumber) {
        const smsContent = `[SHRIMP ALERT] NGUY CAP: ${alertBody}`;
        await this.notificationQueueService.addSendSmsJob(
          user.phoneNumber,
          smsContent,
          { priority: 1, attempts: 3 },
        );
        this.logger.warn(`[Alert Listener] Đã đẩy job gửi SMS khẩn cấp tới ${user.phoneNumber}`);
      }

      // 3. Gửi Email thông báo nếu user có đăng ký địa chỉ email
      if (user.email) {
        await this.notificationQueueService.addSendEmailJob(
          {
            type: 'general',
            email: user.email,
            subject: alertTitle,
            text: alertBody,
          },
          { priority: 1, attempts: 3 },
        );
      }
    } catch (error: any) {
      this.logger.error(
        `[Alert Listener Error] Lỗi xử lý dispatch thông báo từ event alert:triggered: ${error.message}`,
        error.stack,
      );
    }
  }
}
