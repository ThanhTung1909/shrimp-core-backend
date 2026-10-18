import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationDelivery } from './entities/notification-delivery.entity.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { DeliveryStatus } from './enums/delivery-status.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationTokensService } from './notification-tokens.service.js';
import { FcmService } from './fcm.service.js';
import { EsmsService } from '../../common/esms/esms.service.js';
import { EmailService } from '../email/email.service.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { QueryNotificationHistoryDto } from './dto/query-history.dto.js';

export interface AlertDispatchPayload {
  alertId: string;
  pondId: string;
  metricName: string;
  triggeredValue: number;
  alertLevel: string;
  message?: string | null;
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly maxRetries = 3;

  constructor(
    @InjectRepository(NotificationDelivery)
    private readonly deliveryRepo: Repository<NotificationDelivery>,
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly preferencesService: NotificationPreferencesService,
    private readonly tokensService: NotificationTokensService,
    private readonly fcmService: FcmService,
    private readonly esmsService: EsmsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Phương thức dispatch chính khi có cảnh báo mới
   * Đảm bảo tính non-blocking, độc lập kênh và idempotency
   */
  async dispatchAlert(alert: Alert | AlertDispatchPayload): Promise<void> {
    try {
      this.logger.log(`[Dispatcher] Processing ${alert.alertLevel} alert.`);

      // 1. Resolve Recipient qua Ao nuôi (Pond) -> Chủ ao (User)
      const pond = await this.pondRepo.findOne({
        where: { pondId: alert.pondId },
        relations: ['user'],
      });

      if (!pond) {
        this.logger.warn('[Dispatcher] Alert pond not found. Skipping notification dispatch.');
        return;
      }

      let resolvedUser = pond.user;
      if (!resolvedUser && pond.userId) {
        resolvedUser = (await this.userRepo.findOne({
          where: { userId: pond.userId },
        })) as User;
      }

      if (!resolvedUser) {
        this.logger.warn('[Dispatcher] Alert owner not found. Skipping notification dispatch.');
        return;
      }
      const user: User = resolvedUser;

      // Scenario 35: Inactive user excluded
      if (user.isActive === false) {
        this.logger.warn('[Dispatcher] Alert owner is inactive. Dispatch aborted.');
        return;
      }

      // 2. Chuẩn bị danh sách các kênh cần gửi
      const channels = [
        NotificationChannel.FCM,
        NotificationChannel.SMS,
        NotificationChannel.EMAIL,
      ];

      // Dispatch song song đến các kênh với error isolation
      const channelPromises = channels.map((channel) =>
        this.dispatchChannel(channel, alert, pond, user),
      );

      await Promise.allSettled(channelPromises);
      this.logger.log('[Dispatcher] Completed multi-channel dispatch.');
    } catch {
      // Telemetry processing must not be blocked or crash
      this.logger.error('[Dispatcher] Unhandled error during alert dispatch.');
    }
  }

  /**
   * Xử lý dispatch cho từng kênh độc lập
   */
  private async dispatchChannel(
    channel: NotificationChannel,
    alert: Alert | AlertDispatchPayload,
    pond: Pond,
    user: User,
  ): Promise<void> {
    const alertLevel = alert.alertLevel as any;

    // 1. Kiểm tra User Preference cho kênh & mức độ cảnh báo
    const isEnabled = await this.preferencesService.isChannelEnabled(
      user.userId,
      alertLevel,
      channel,
    );

    if (!isEnabled) {
      this.logger.debug(
        `[Dispatcher] Channel ${channel} is disabled by user preferences for ${alertLevel}.`,
      );
      return;
    }

    // 2. Idempotency & Deduplication Check (alertId + userId + channel)
    let delivery = await this.deliveryRepo.findOne({
      where: {
        alertId: alert.alertId,
        userId: user.userId,
        channel,
      },
    });
    let createdByThisDispatch = false;

    if (!delivery) {
      // The database uniqueness constraint makes this create operation the
      // atomic ownership claim for a channel delivery. A competing worker
      // receives a duplicate-key error and observes the winner's state below.
      const newDelivery = this.deliveryRepo.create({
        alertId: alert.alertId,
        userId: user.userId,
        channel,
        status: DeliveryStatus.PROCESSING,
        attemptCount: 1,
        lastAttemptAt: new Date(),
      });

      try {
        delivery = await this.deliveryRepo.save(newDelivery);
        createdByThisDispatch = true;
      } catch (error: any) {
        if (error?.code !== '23505') {
          throw error;
        }

        delivery = await this.deliveryRepo.findOne({
          where: {
            alertId: alert.alertId,
            userId: user.userId,
            channel,
          },
        });

        if (!delivery) {
          throw error;
        }
      }
    }

    if (!createdByThisDispatch) {
      // Scenario 31: Already sent channel not resent
      if (
        delivery.status === DeliveryStatus.PROVIDER_ACCEPTED ||
        delivery.status === DeliveryStatus.SENT
      ) {
        this.logger.debug(
          `[Dispatcher] Channel ${channel} was already accepted by the provider. Skipping.`,
        );
        return;
      }

      // Scenario 34: Concurrent worker processing guard
      if (delivery.status === DeliveryStatus.PROCESSING) {
        this.logger.debug(
          `[Dispatcher] Channel ${channel} is currently PROCESSING. Skipping.`,
        );
        return;
      }

      // Scenario 30: Retry exhaustion check
      if (
        delivery.status === DeliveryStatus.FAILED &&
        delivery.attemptCount >= this.maxRetries
      ) {
        this.logger.warn(
          `[Dispatcher] Channel ${channel} exhausted all ${this.maxRetries} retries.`,
        );
        return;
      }

      // Increment attempt count for retry
      delivery.status = DeliveryStatus.PROCESSING;
      delivery.attemptCount += 1;
      delivery.lastAttemptAt = new Date();
      await this.deliveryRepo.save(delivery);
    }

    // 3. Thực thi gửi theo từng channel
    try {
      switch (channel) {
        case NotificationChannel.FCM:
          await this.executeFcmDispatch(delivery, alert, pond, user);
          break;
        case NotificationChannel.SMS:
          await this.executeSmsDispatch(delivery, alert, pond, user);
          break;
        case NotificationChannel.EMAIL:
          await this.executeEmailDispatch(delivery, alert, pond, user);
          break;
      }
    } catch (channelError: any) {
      // Partial channel failure isolation
      this.logger.error(`[Dispatcher] Failure in channel ${channel}; delivery was recorded as failed.`);
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = `${channel}_ERROR`;
      delivery.failureReason = channelError.message;
      await this.deliveryRepo.save(delivery);
    }
  }

  private async executeFcmDispatch(
    delivery: NotificationDelivery,
    alert: Alert | AlertDispatchPayload,
    pond: Pond,
    user: User,
  ): Promise<void> {
    const tokens = await this.tokensService.getActiveTokens(user.userId);
    delivery.recipient = tokens.length > 0 ? `${tokens.length} device(s)` : null;

    if (tokens.length === 0) {
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = 'NO_FCM_TOKEN';
      delivery.failureReason = 'Người dùng không có FCM token hợp lệ';
      await this.deliveryRepo.save(delivery);
      return;
    }

    const title = `[CẢNH BÁO ${alert.alertLevel}] ${alert.metricName}`;
    const body = `Ao ${pond.pondName}: ${alert.metricName} vượt ngưỡng (${alert.triggeredValue}). ${alert.message || ''}`.trim();
    const data = {
      alertId: alert.alertId,
      pondId: pond.pondId,
      alertLevel: alert.alertLevel,
      metricName: alert.metricName,
      triggeredValue: String(alert.triggeredValue),
    };

    const result = await this.fcmService.sendToTokens(tokens, title, body, data);

    if (result.invalidTokens && result.invalidTokens.length > 0) {
      await this.tokensService.deactivateTokens(result.invalidTokens);
    }

    if (result.successCount > 0) {
      // This is not proof that the device displayed the push notification.
      delivery.status = DeliveryStatus.PROVIDER_ACCEPTED;
      delivery.sentAt = new Date();
      delivery.failureCode = null;
      delivery.failureReason = null;
    } else {
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = 'FCM_PROVIDER_FAILED';
      delivery.failureReason = `Failed to deliver to all ${tokens.length} token(s)`;
    }

    await this.deliveryRepo.save(delivery);
  }

  private async executeSmsDispatch(
    delivery: NotificationDelivery,
    alert: Alert | AlertDispatchPayload,
    pond: Pond,
    user: User,
  ): Promise<void> {
    delivery.recipient = user.phoneNumber;

    // Scenario 9: Missing phone
    if (!user.phoneNumber) {
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = 'MISSING_PHONE';
      delivery.failureReason = 'Người dùng chưa cập nhật số điện thoại';
      await this.deliveryRepo.save(delivery);
      return;
    }

    const message = `[AquaSense] CANH BAO ${alert.alertLevel} tai ao ${pond.pondName}: Chi so ${alert.metricName} = ${alert.triggeredValue}. ${alert.message || ''}`.trim();

    try {
      await this.esmsService.sendAlertSMS(user.phoneNumber, message);
      // eSMS accepted the request; handset delivery is not tracked.
      delivery.status = DeliveryStatus.PROVIDER_ACCEPTED;
      delivery.sentAt = new Date();
      delivery.failureCode = null;
      delivery.failureReason = null;
    } catch (smsErr: any) {
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = 'SMS_GATEWAY_ERROR';
      delivery.failureReason = smsErr.message;
    }

    await this.deliveryRepo.save(delivery);
  }

  private async executeEmailDispatch(
    delivery: NotificationDelivery,
    alert: Alert | AlertDispatchPayload,
    pond: Pond,
    user: User,
  ): Promise<void> {
    delivery.recipient = user.email;

    // Scenario 13: Missing email
    if (!user.email) {
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = 'MISSING_EMAIL';
      delivery.failureReason = 'Người dùng chưa cập nhật địa chỉ email';
      await this.deliveryRepo.save(delivery);
      return;
    }

    try {
      await this.emailService.sendAlertEmail(user.email, user.fullName, {
        alertId: alert.alertId,
        pondName: pond.pondName,
        pondId: pond.pondId,
        metricName: alert.metricName,
        triggeredValue: alert.triggeredValue,
        alertLevel: alert.alertLevel,
        message: alert.message || undefined,
      });

      // SMTP accepted the message; inbox delivery is not tracked.
      delivery.status = DeliveryStatus.PROVIDER_ACCEPTED;
      delivery.sentAt = new Date();
      delivery.failureCode = null;
      delivery.failureReason = null;
    } catch (emailErr: any) {
      delivery.status = DeliveryStatus.FAILED;
      delivery.failureCode = 'EMAIL_GATEWAY_ERROR';
      delivery.failureReason = emailErr.message;
    }

    await this.deliveryRepo.save(delivery);
  }

  /**
   * Lấy lịch sử gửi thông báo của người dùng với phân trang
   */
  async getDeliveryHistory(
    userId: string,
    query: QueryNotificationHistoryDto,
  ): Promise<{ data: NotificationDelivery[]; total: number; page: number; limit: number }> {
    const { page = 1, limit = 20, channel, status } = query;
    const skip = (page - 1) * limit;

    const qb = this.deliveryRepo.createQueryBuilder('delivery');
    qb.where('delivery.user_id = :userId', { userId });

    if (channel) {
      qb.andWhere('delivery.channel = :channel', { channel });
    }

    if (status) {
      qb.andWhere('delivery.status = :status', { status });
    }

    qb.orderBy('delivery.created_at', 'DESC');
    qb.skip(skip);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
    };
  }
}
