import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationsController } from './notifications.controller.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let mockPreferencesService: any;
  let mockTokensService: any;
  let mockDispatcherService: any;

  const userId = 'user-test-123';

  beforeEach(() => {
    vi.clearAllMocks();

    mockPreferencesService = {
      getUserPreferences: vi.fn().mockResolvedValue([
        { severity: AlertLevel.CRITICAL, channel: NotificationChannel.FCM, enabled: true },
      ]),
      updatePreferences: vi.fn().mockResolvedValue([
        { severity: AlertLevel.CRITICAL, channel: NotificationChannel.SMS, enabled: true },
      ]),
    };

    mockTokensService = {
      registerToken: vi.fn().mockResolvedValue({
        tokenId: 'tok-1',
        token: 'device-token-123',
        platform: 'android',
      }),
      unregisterToken: vi.fn().mockResolvedValue(true),
    };

    mockDispatcherService = {
      getDeliveryHistory: vi.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
    };

    controller = new NotificationsController(
      mockPreferencesService,
      mockTokensService,
      mockDispatcherService,
    );
  });

  it('GET /notifications/preferences - trả về preferences của user hiện tại', async () => {
    const res = await controller.getMyPreferences(userId);
    expect(mockPreferencesService.getUserPreferences).toHaveBeenCalledWith(userId);
    expect(res).toBeDefined();
  });

  it('PATCH /notifications/preferences - cập nhật preferences của user', async () => {
    const dto = {
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.SMS,
      enabled: true,
    };
    const res = await controller.updateMyPreferences(userId, dto as any);
    expect(mockPreferencesService.updatePreferences).toHaveBeenCalledWith(userId, dto);
    expect(res).toBeDefined();
  });

  it('POST /notifications/fcm-tokens - đăng ký FCM token cho user', async () => {
    const dto = { token: 'device-token-123', platform: 'android' };
    const res = await controller.registerFcmToken(userId, dto);
    expect(mockTokensService.registerToken).toHaveBeenCalledWith(userId, dto);
    expect(res.token).toBe('device-token-123');
  });

  it('DELETE /notifications/fcm-tokens - hủy đăng ký FCM token', async () => {
    const dto = { token: 'device-token-123' };
    const res = await controller.unregisterFcmToken(userId, dto);
    expect(mockTokensService.unregisterToken).toHaveBeenCalledWith(userId, 'device-token-123');
    expect(res.message).toContain('Hủy đăng ký');
  });

  it('GET /notifications - lấy lịch sử delivery với query pagination', async () => {
    const query = { page: 1, limit: 10 };
    const res = await controller.getHistory(userId, query);
    expect(mockDispatcherService.getDeliveryHistory).toHaveBeenCalledWith(userId, query);
    expect(res.total).toBe(0);
  });
});
