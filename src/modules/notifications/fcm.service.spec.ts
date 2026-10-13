import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { FcmService } from './fcm.service.js';
import { ConfigService } from '@nestjs/config';
import * as adminApp from 'firebase-admin/app';
import * as adminMessaging from 'firebase-admin/messaging';
import { NotificationTokensService } from './notification-tokens.service.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
  cert: vi.fn(),
}));

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(),
}));

describe('FcmService & FCM Security (Scenarios 1 - 6)', () => {
  let fcmService: FcmService;
  let configService: ConfigService;
  let mockMessagingInstance: { sendEachForMulticast: Mock };

  let tokensService: NotificationTokensService;
  let mockTokenRepo: any;
  let mockUserRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'FIREBASE_PROJECT_ID') return 'test-project';
        if (key === 'FIREBASE_CLIENT_EMAIL') return 'test@project.iam.gserviceaccount.com';
        if (key === 'FIREBASE_PRIVATE_KEY') return '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEF\\n-----END PRIVATE KEY-----';
        return null;
      }),
    } as any;

    mockMessagingInstance = {
      sendEachForMulticast: vi.fn(),
    };

    (adminMessaging.getMessaging as any).mockReturnValue(mockMessagingInstance);
    (adminApp.getApps as any).mockReturnValue([]);
    (adminApp.initializeApp as any).mockReturnValue({ name: '[DEFAULT]' });

    fcmService = new FcmService(configService);
    fcmService.onModuleInit();

    // Mocks cho NotificationTokensService phục vụ scenario 5 & 6
    mockTokenRepo = {
      findOne: vi.fn(),
      save: vi.fn((entity) => Promise.resolve(entity)),
      create: vi.fn((entity) => entity),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    mockUserRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn(),
    };

    tokensService = new NotificationTokensService(mockTokenRepo, mockUserRepo);
  });

  // Scenario 1: Send success
  it('Scenario 1: Send success - gửi FCM push notification thành công đến các token hợp lệ', async () => {
    mockMessagingInstance.sendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'msg-123' }],
    });

    const result = await fcmService.sendToTokens(
      ['valid-fcm-token-1'],
      'Test Alert',
      'Test Message Body',
      { alertId: 'alert-1' },
    );

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.invalidTokens).toHaveLength(0);
    expect(mockMessagingInstance.sendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  // Scenario 2: Invalid token
  it('Scenario 2: Invalid token - phát hiện token hết hạn hoặc không tồn tại và trả về danh sách invalidTokens', async () => {
    mockMessagingInstance.sendEachForMulticast.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: {
            code: 'messaging/registration-token-not-registered',
            message: 'Token not registered',
          },
        },
      ],
    });

    const result = await fcmService.sendToTokens(
      ['expired-fcm-token'],
      'Warning Alert',
      'High Ammonia',
    );

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(1);
    expect(result.invalidTokens).toContain('expired-fcm-token');
  });

  // Scenario 3: Multiple devices
  it('Scenario 3: Multiple devices - gửi multicast tới nhiều thiết bị cùng lúc', async () => {
    const tokens = ['device-token-android', 'device-token-ios', 'device-token-tablet'];

    mockMessagingInstance.sendEachForMulticast.mockResolvedValueOnce({
      successCount: 2,
      failureCount: 1,
      responses: [
        { success: true, messageId: 'msg-1' },
        { success: true, messageId: 'msg-2' },
        {
          success: false,
          error: { code: 'messaging/invalid-registration-token' },
        },
      ],
    });

    const result = await fcmService.sendToTokens(tokens, 'Critical Alert', 'DO dropped below 3.0');

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.invalidTokens).toEqual(['device-token-tablet']);
    expect(mockMessagingInstance.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens }),
    );
  });

  // Scenario 4: Provider timeout / failure handling
  it('Scenario 4: Provider timeout - xử lý lỗi khi Firebase network bị timeout hoặc gateway ngắt kết nối', async () => {
    mockMessagingInstance.sendEachForMulticast.mockRejectedValueOnce(
      new Error('ETIMEDOUT: Connection to Firebase Gateway timed out'),
    );

    await expect(
      fcmService.sendToTokens(['any-token'], 'Timeout Alert', 'Test Message'),
    ).rejects.toThrow('ETIMEDOUT');
  });

  // Scenario 5: Token unregister
  it('Scenario 5: Token unregister - hủy kích hoạt device token thành công và xóa fallback user fcmToken', async () => {
    const userId = 'user-uuid-1';
    const token = 'token-to-unregister';

    mockTokenRepo.findOne.mockResolvedValueOnce({
      tokenId: 'token-id-1',
      userId,
      token,
      isActive: true,
    });

    const success = await tokensService.unregisterToken(userId, token);

    expect(success).toBe(true);
    expect(mockTokenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(mockUserRepo.update).toHaveBeenCalledWith(
      { userId, fcmToken: token },
      { fcmToken: null },
    );
  });

  // Scenario 6: Unauthorized token access
  it('Scenario 6: Unauthorized token access - chặn người dùng khác hủy kích hoạt token không thuộc quyền sở hữu', async () => {
    const ownerUserId = 'owner-user-uuid';
    const attackerUserId = 'attacker-user-uuid';
    const token = 'device-token-victim';

    mockTokenRepo.findOne.mockResolvedValueOnce({
      tokenId: 'token-id-99',
      userId: ownerUserId,
      token,
      isActive: true,
    });

    await expect(
      tokensService.unregisterToken(attackerUserId, token),
    ).rejects.toThrow(ForbiddenException);

    expect(mockTokenRepo.save).not.toHaveBeenCalled();
  });
});
