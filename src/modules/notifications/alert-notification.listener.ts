import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
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
    private readonly notificationDispatcher: NotificationDispatcherService,
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
      const { pondId, alert } = payload;

      if (!alert) return;

      const resolvedPondId = pondId || alert.pondId;
      if (!alert.alertId || !resolvedPondId || !alert.metricName || alert.triggeredValue === undefined) {
        this.logger.warn('[Alert Listener] Event thiếu dữ liệu alert cần thiết, bỏ qua dispatch notification.');
        return;
      }

      // Every alert event uses the canonical dispatcher. It resolves the pond
      // owner, evaluates channel preferences, records delivery state, and
      // sends via the real FCM/eSMS/email services. This avoids a second,
      // preference-bypassing notification path.
      await this.notificationDispatcher.dispatchAlert({
        alertId: alert.alertId,
        pondId: resolvedPondId,
        metricName: alert.metricName,
        triggeredValue: alert.triggeredValue,
        alertLevel: alert.alertLevel || AlertLevel.WARNING,
        message: alert.message,
      });
    } catch {
      this.logger.error('[Alert Listener] Notification dispatch from alert event failed.');
    }
  }
}
