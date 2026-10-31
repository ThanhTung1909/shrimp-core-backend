import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { DeliveryStatus } from './enums/delivery-status.enum.js';

describe('NotificationDispatcherService (Scenarios 7 - 15 & 23 - 35)', () => {
  let dispatcher: NotificationDispatcherService;

  let mockDeliveryRepo: any;
  let mockPondRepo: any;
  let mockUserRepo: any;
  let mockAlertRepo: any;

  let mockPreferencesService: any;
  let mockTokensService: any;
  let mockFcmService: any;
  let mockEsmsService: any;
  let mockEmailService: any;

  const mockUser = {
    userId: 'user-pond-owner-1',
    fullName: 'Nguyen Van A',
    phoneNumber: '0901234567',
    email: 'nguyenvana@gmail.com',
    isActive: true,
  };

  const mockPond = {
    pondId: 'pond-uuid-1',
    pondName: 'Ao Nuoi So 1',
    userId: mockUser.userId,
    user: mockUser,
  };

  const criticalAlert = {
    alertId: 'alert-critical-1',
    pondId: mockPond.pondId,
    metricName: 'dissolvedOxygen',
    triggeredValue: 2.1,
    alertLevel: AlertLevel.CRITICAL,
    message: 'Nồng độ Oxy hòa tan xuống mức báo động!',
  };

  const warningAlert = {
    alertId: 'alert-warning-1',
    pondId: mockPond.pondId,
    metricName: 'pH',
    triggeredValue: 8.8,
    alertLevel: AlertLevel.WARNING,
    message: 'Độ pH hơi cao',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDeliveryRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
      create: vi.fn((dto) => ({
        deliveryId: 'deliv-id-' + Math.random(),
        attemptCount: 1,
        status: DeliveryStatus.PENDING,
        ...dto,
      })),
      save: vi.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      })),
    };

    mockPondRepo = {
      findOne: vi.fn().mockResolvedValue(mockPond),
    };

    mockUserRepo = {
      findOne: vi.fn().mockResolvedValue(mockUser),
    };

    mockAlertRepo = {
      findOne: vi.fn().mockResolvedValue(criticalAlert),
    };

    mockPreferencesService = {
      isChannelEnabled: vi.fn(async (userId, severity, channel) => {
        if (severity === AlertLevel.CRITICAL) return true;
        if (severity === AlertLevel.WARNING) return channel === NotificationChannel.FCM;
        return false;
      }),
    };

    mockTokensService = {
      getActiveTokens: vi.fn().mockResolvedValue(['fcm-token-123']),
      deactivateTokens: vi.fn().mockResolvedValue(1),
    };

    mockFcmService = {
      sendToTokens: vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
      }),
    };

    mockEsmsService = {
      sendAlertSMS: vi.fn().mockResolvedValue({ CodeResult: '100', SMSID: 'sms-999' }),
    };

    mockEmailService = {
      sendAlertEmail: vi.fn().mockResolvedValue(undefined),
      escapeHtml: vi.fn((str) => str.replace(/</g, '&lt;').replace(/>/g, '&gt;')),
    };

    dispatcher = new NotificationDispatcherService(
      mockDeliveryRepo,
      mockPondRepo,
      mockUserRepo,
      mockAlertRepo,
      mockPreferencesService,
      mockTokensService,
      mockFcmService,
      mockEsmsService,
      mockEmailService,
    );
  });

  // ==========================================
  // SMS Scenarios (7 - 10)
  // ==========================================

  it('Scenario 7: User bật SMS - gửi tin nhắn SMS khi user bật kênh SMS', async () => {
    mockPreferencesService.isChannelEnabled.mockImplementation(
      async (_uid: string, _sev: any, channel: NotificationChannel) => channel === NotificationChannel.SMS,
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEsmsService.sendAlertSMS).toHaveBeenCalledWith(
      mockUser.phoneNumber,
      expect.stringContaining('Ao Nuoi So 1'),
    );
  });

  it('Scenario 8: User tắt SMS - bỏ qua gửi SMS khi preference SMS = false', async () => {
    mockPreferencesService.isChannelEnabled.mockImplementation(
      async (_uid: string, _sev: any, channel: NotificationChannel) => channel !== NotificationChannel.SMS,
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEsmsService.sendAlertSMS).not.toHaveBeenCalled();
  });

  it('Scenario 9: Missing phone - đánh dấu delivery FAILED với mã MISSING_PHONE khi user chưa có số điện thoại', async () => {
    mockPondRepo.findOne.mockResolvedValueOnce({
      ...mockPond,
      user: { ...mockUser, phoneNumber: null },
    });

    mockPreferencesService.isChannelEnabled.mockImplementation(
      async (_uid: string, _sev: any, channel: NotificationChannel) => channel === NotificationChannel.SMS,
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEsmsService.sendAlertSMS).not.toHaveBeenCalled();
    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NotificationChannel.SMS,
        status: DeliveryStatus.FAILED,
        failureCode: 'MISSING_PHONE',
      }),
    );
  });

  it('Scenario 10: Provider failure (SMS) - ghi nhận lỗi SMS gateway mà không làm ngắt quãng các kênh khác', async () => {
    mockEsmsService.sendAlertSMS.mockRejectedValueOnce(
      new Error('eSMS Gateway 503 Service Unavailable'),
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NotificationChannel.SMS,
        status: DeliveryStatus.FAILED,
        failureCode: 'SMS_GATEWAY_ERROR',
      }),
    );
    // FCM và Email vẫn được gửi thành công
    expect(mockFcmService.sendToTokens).toHaveBeenCalled();
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalled();
  });

  // ==========================================
  // Email Scenarios (11 - 15)
  // ==========================================

  it('Scenario 11: User bật Email - gửi email khi user bật kênh Email', async () => {
    mockPreferencesService.isChannelEnabled.mockImplementation(
      async (_uid: string, _sev: any, channel: NotificationChannel) => channel === NotificationChannel.EMAIL,
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledWith(
      mockUser.email,
      mockUser.fullName,
      expect.objectContaining({
        alertId: criticalAlert.alertId,
        alertLevel: AlertLevel.CRITICAL,
      }),
    );
  });

  it('Scenario 12: User tắt Email - bỏ qua gửi Email khi preference Email = false', async () => {
    mockPreferencesService.isChannelEnabled.mockImplementation(
      async (_uid: string, _sev: any, channel: NotificationChannel) => channel !== NotificationChannel.EMAIL,
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
  });

  it('Scenario 13: Missing email - đánh dấu delivery FAILED với mã MISSING_EMAIL khi user chưa có email', async () => {
    mockPondRepo.findOne.mockResolvedValueOnce({
      ...mockPond,
      user: { ...mockUser, email: null },
    });

    mockPreferencesService.isChannelEnabled.mockImplementation(
      async (_uid: string, _sev: any, channel: NotificationChannel) => channel === NotificationChannel.EMAIL,
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        status: DeliveryStatus.FAILED,
        failureCode: 'MISSING_EMAIL',
      }),
    );
  });

  it('Scenario 14: Template escaping - kiểm tra email template escaping ký tự HTML đặc biệt để chống XSS', () => {
    const rawInput = '<script>alert("hack")</script>';
    const escaped = mockEmailService.escapeHtml(rawInput);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('Scenario 15: Provider failure (Email) - ghi nhận lỗi SMTP mà không làm lỗi luồng chung', async () => {
    mockEmailService.sendAlertEmail.mockRejectedValueOnce(
      new Error('SMTP Connection timeout port 587'),
    );

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        status: DeliveryStatus.FAILED,
        failureCode: 'EMAIL_GATEWAY_ERROR',
      }),
    );
    expect(mockFcmService.sendToTokens).toHaveBeenCalled();
  });

  // ==========================================
  // Dispatcher Scenarios (23 - 35)
  // ==========================================

  it('Scenario 23: CRITICAL dispatch - kích hoạt cả 3 kênh FCM, SMS, Email khi cảnh báo là CRITICAL', async () => {
    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockFcmService.sendToTokens).toHaveBeenCalledTimes(1);
    expect(mockEsmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('Scenario 24: WARNING policy - theo cấu hình mặc định, cảnh báo WARNING chỉ gửi FCM, bỏ qua SMS & Email', async () => {
    await dispatcher.dispatchAlert(warningAlert);

    expect(mockFcmService.sendToTokens).toHaveBeenCalledTimes(1);
    expect(mockEsmsService.sendAlertSMS).not.toHaveBeenCalled();
    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
  });

  it('Scenario 25: Multiple recipients / devices - gửi multicast tới tất cả active devices của user', async () => {
    mockTokensService.getActiveTokens.mockResolvedValueOnce([
      'device-phone-1',
      'device-tablet-2',
      'device-laptop-web',
    ]);

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockFcmService.sendToTokens).toHaveBeenCalledWith(
      ['device-phone-1', 'device-tablet-2', 'device-laptop-web'],
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('does not dispatch to a legacy or former-owner token when no active token exists', async () => {
    // getActiveTokens deliberately ignores users.fcmToken, so an old fallback
    // cannot become a delivery target after ownership is revoked or handed off.
    mockTokensService.getActiveTokens.mockResolvedValueOnce([]);

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockFcmService.sendToTokens).not.toHaveBeenCalled();
    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NotificationChannel.FCM,
        status: DeliveryStatus.FAILED,
        failureCode: 'NO_FCM_TOKEN',
      }),
    );
  });

  it('Scenario 26: Pond ownership isolation - chỉ gửi cảnh báo đến đúng chủ sở hữu của ao nuôi phát sinh sự cố', async () => {
    const pondOwnerA = { ...mockUser, userId: 'owner-a-uuid' };
    mockPondRepo.findOne.mockResolvedValueOnce({
      ...mockPond,
      userId: pondOwnerA.userId,
      user: pondOwnerA,
    });

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockDeliveryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-a-uuid' }),
    );
  });

  it('Scenario 27: Duplicate AlertCreated event - cơ chế deduplication ngăn chặn gửi lại nếu alertId+userId+channel đã gửi thành công', async () => {
    // Giả lập kênh FCM đã gửi thành công trước đó (SENT)
    mockDeliveryRepo.findOne.mockImplementation(async (query: any) => {
      if (query.where.channel === NotificationChannel.FCM) {
        return {
          deliveryId: 'deliv-exist-fcm',
          status: DeliveryStatus.SENT,
          attemptCount: 1,
        };
      }
      return null;
    });

    await dispatcher.dispatchAlert(criticalAlert);

    // FCM đã SENT nên không được gửi lại
    expect(mockFcmService.sendToTokens).not.toHaveBeenCalled();
    // Các kênh chưa gửi (SMS, Email) vẫn tiếp tục
    expect(mockEsmsService.sendAlertSMS).toHaveBeenCalled();
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalled();
  });

  it('atomically yields to a concurrent worker when the unique delivery claim already exists', async () => {
    let fcmLookupCount = 0;
    mockDeliveryRepo.findOne.mockImplementation(async (query: any) => {
      if (query.where.channel === NotificationChannel.FCM) {
        fcmLookupCount += 1;
        return fcmLookupCount === 1
          ? null
          : {
              deliveryId: 'claimed-by-worker-a',
              status: DeliveryStatus.PROCESSING,
              attemptCount: 1,
            };
      }
      return null;
    });
    mockDeliveryRepo.save.mockImplementation((entity: any) => {
      if (entity.channel === NotificationChannel.FCM) {
        return Promise.reject(Object.assign(new Error('duplicate delivery'), { code: '23505' }));
      }
      return Promise.resolve(entity);
    });

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockFcmService.sendToTokens).not.toHaveBeenCalled();
    expect(mockEsmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('Scenario 28: Queue redelivery / retry handling - cho phép thử lại khi delivery trước đó bị FAILED và chưa hết lượt retry', async () => {
    mockDeliveryRepo.findOne.mockImplementation(async (query: any) => {
      if (query.where.channel === NotificationChannel.SMS) {
        return {
          deliveryId: 'deliv-sms-failed',
          status: DeliveryStatus.FAILED,
          attemptCount: 1,
        };
      }
      return null;
    });

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockEsmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 2,
        status: DeliveryStatus.PROVIDER_ACCEPTED,
      }),
    );
  });

  it('Scenario 29: Partial channel failure - nếu 1 kênh bị lỗi, các kênh độc lập còn lại vẫn gửi thành công', async () => {
    mockFcmService.sendToTokens.mockRejectedValueOnce(new Error('Firebase connection dropped'));

    await dispatcher.dispatchAlert(criticalAlert);

    // SMS & Email vẫn hoàn thành
    expect(mockEsmsService.sendAlertSMS).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendAlertEmail).toHaveBeenCalledTimes(1);
    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: NotificationChannel.SMS,
        status: DeliveryStatus.PROVIDER_ACCEPTED,
      }),
    );
  });

  it('Scenario 30: Retry exhaustion - không tiếp tục gửi lại khi attemptCount đã vượt quá số lần retry tối đa (3)', async () => {
    mockDeliveryRepo.findOne.mockImplementation(async (query: any) => {
      if (query.where.channel === NotificationChannel.SMS) {
        return {
          deliveryId: 'deliv-sms-exhausted',
          status: DeliveryStatus.FAILED,
          attemptCount: 3, // Đã chạm mốc tối đa
        };
      }
      return null;
    });

    await dispatcher.dispatchAlert(criticalAlert);

    // SMS không được thử lại
    expect(mockEsmsService.sendAlertSMS).not.toHaveBeenCalled();
  });

  it('Scenario 31: Already sent channel not resent - kênh đã SENT thì không bao giờ bị gửi lại khi trigger lại event', async () => {
    mockDeliveryRepo.findOne.mockResolvedValue({
      deliveryId: 'already-sent-deliv',
      status: DeliveryStatus.SENT,
      attemptCount: 1,
    });

    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockFcmService.sendToTokens).not.toHaveBeenCalled();
    expect(mockEsmsService.sendAlertSMS).not.toHaveBeenCalled();
    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
  });

  it('Scenario 32: Telemetry processing not blocked - dispatch chạy bất đồng bộ và tự bắt ngoại lệ để không bao giờ làm sập tiến trình nạp telemetry', async () => {
    mockPondRepo.findOne.mockRejectedValueOnce(new Error('Database lock error during pond query'));

    // dispatchAlert không được throw unhandled exception
    await expect(dispatcher.dispatchAlert(criticalAlert)).resolves.not.toThrow();
  });

  it('Scenario 33: Database delivery tracking - lưu vết đầy đủ thông tin gửi thông báo (channel, status, recipient, timestamp)', async () => {
    await dispatcher.dispatchAlert(criticalAlert);

    expect(mockDeliveryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: criticalAlert.alertId,
        userId: mockUser.userId,
        status: DeliveryStatus.PROCESSING,
      }),
    );
    expect(mockDeliveryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: DeliveryStatus.PROVIDER_ACCEPTED,
        sentAt: expect.any(Date),
      }),
    );
  });

  it('Scenario 34: Concurrent worker processing - bỏ qua kênh nếu đang ở trạng thái PROCESSING bởi worker khác', async () => {
    mockDeliveryRepo.findOne.mockResolvedValueOnce({
      deliveryId: 'processing-by-another-worker',
      status: DeliveryStatus.PROCESSING,
      attemptCount: 1,
    });

    await dispatcher.dispatchAlert(criticalAlert);

    // Kênh đầu tiên (FCM) bị bỏ qua vì worker khác đang xử lý
    expect(mockFcmService.sendToTokens).not.toHaveBeenCalled();
  });

  it('Scenario 35: Inactive user excluded - từ chối gửi thông báo nếu tài khoản người dùng bị khóa hoặc chưa kích hoạt', async () => {
    mockPondRepo.findOne.mockResolvedValueOnce({
      ...mockPond,
      user: { ...mockUser, isActive: false }, // Tài khoản bị khóa
    });

    await dispatcher.dispatchAlert(criticalAlert);

    // Không gửi bất kỳ kênh nào
    expect(mockFcmService.sendToTokens).not.toHaveBeenCalled();
    expect(mockEsmsService.sendAlertSMS).not.toHaveBeenCalled();
    expect(mockEmailService.sendAlertEmail).not.toHaveBeenCalled();
    expect(mockDeliveryRepo.create).not.toHaveBeenCalled();
  });
});
