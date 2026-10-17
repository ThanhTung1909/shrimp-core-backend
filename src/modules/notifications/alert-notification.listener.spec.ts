import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertNotificationListener } from './alert-notification.listener.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';

describe('AlertNotificationListener', () => {
  let listener: AlertNotificationListener;
  let mockRedisService: any;
  let mockUsersService: any;
  let mockNotificationQueueService: any;
  let mockSubscriber: any;

  beforeEach(() => {
    mockSubscriber = {
      subscribe: vi.fn((channel, cb) => cb?.(null, 1)),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    };

    mockRedisService = {
      getClient: vi.fn(() => ({
        duplicate: vi.fn(() => mockSubscriber),
      })),
    };

    mockUsersService = {
      findById: vi.fn(),
    };

    mockNotificationQueueService = {
      addSendFcmJob: vi.fn().mockResolvedValue({ id: 'fcm-1' }),
      addSendSmsJob: vi.fn().mockResolvedValue({ id: 'sms-1' }),
      addSendEmailJob: vi.fn().mockResolvedValue({ id: 'email-1' }),
    };

    listener = new AlertNotificationListener(
      mockRedisService,
      mockUsersService,
      mockNotificationQueueService,
    );
  });

  it('subscribes to alert:triggered channel on init', () => {
    listener.onModuleInit();
    expect(mockRedisService.getClient).toHaveBeenCalled();
    expect(mockSubscriber.subscribe).toHaveBeenCalledWith(
      'alert:triggered',
      expect.any(Function),
    );
  });

  it('bỏ qua nếu payload không có alert hoặc userId', async () => {
    await listener.handleAlertMessage(JSON.stringify({ pondId: 'pond-1' }));
    expect(mockUsersService.findById).not.toHaveBeenCalled();

    await listener.handleAlertMessage(
      JSON.stringify({ pondId: 'pond-1', alert: { message: 'test' } }),
    );
    expect(mockUsersService.findById).not.toHaveBeenCalled();
  });

  it('dispatches FCM, Email, and SMS when alert is CRITICAL and user has all credentials', async () => {
    mockUsersService.findById.mockResolvedValue({
      userId: 'user-1',
      fullName: 'Nguyen Van A',
      phoneNumber: '0901234567',
      email: 'vana@shrimp.vn',
      fcmToken: 'fcm-token-123',
    });

    const alert = {
      alertId: 'alert-1',
      pondId: 'pond-1',
      deviceId: 'dev-1',
      metricName: 'dissolvedOxygen',
      triggeredValue: 2.1,
      alertLevel: AlertLevel.CRITICAL,
      message: 'Chỉ số Oxy hòa tan đo được 2.1 mg/L, thấp hơn ngưỡng nguy cấp 4.0!',
    };

    await listener.handleAlertMessage(
      JSON.stringify({
        pondId: 'pond-1',
        userId: 'user-1',
        alert,
      }),
    );

    expect(mockUsersService.findById).toHaveBeenCalledWith('user-1');

    // Kiểm tra FCM được đẩy với priority: 1, attempts: 3
    expect(mockNotificationQueueService.addSendFcmJob).toHaveBeenCalledWith(
      expect.objectContaining({
        fcmToken: 'fcm-token-123',
        title: expect.stringContaining('BÁO ĐỘNG ĐỎ'),
        body: expect.stringContaining('2.1 mg/L'),
      }),
      { priority: 1, attempts: 3 },
    );

    // Kiểm tra SMS khẩn cấp được đẩy với priority: 1, attempts: 3
    expect(mockNotificationQueueService.addSendSmsJob).toHaveBeenCalledWith(
      '0901234567',
      expect.stringContaining('NGUY CAP'),
      { priority: 1, attempts: 3 },
    );

    // Kiểm tra Email được đẩy với priority: 1
    expect(mockNotificationQueueService.addSendEmailJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'general',
        email: 'vana@shrimp.vn',
        subject: expect.stringContaining('BÁO ĐỘNG ĐỎ'),
      }),
      { priority: 1, attempts: 3 },
    );
  });

  it('không gửi SMS nếu alert chỉ là WARNING', async () => {
    mockUsersService.findById.mockResolvedValue({
      userId: 'user-1',
      phoneNumber: '0901234567',
      fcmToken: 'fcm-token-123',
    });

    const alert = {
      alertId: 'alert-2',
      alertLevel: AlertLevel.WARNING,
      message: 'Nhiệt độ hơi cao',
    };

    await listener.handleAlertMessage(
      JSON.stringify({
        pondId: 'pond-1',
        userId: 'user-1',
        alert,
      }),
    );

    expect(mockNotificationQueueService.addSendFcmJob).toHaveBeenCalled();
    expect(mockNotificationQueueService.addSendSmsJob).not.toHaveBeenCalled();
  });
});
