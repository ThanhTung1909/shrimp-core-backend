import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationTokensService } from './notification-tokens.service.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('NotificationTokensService', () => {
  let service: NotificationTokensService;
  let mockTokenRepo: any;
  let mockUserRepo: any;

  const userId = 'user-uuid-1';

  beforeEach(() => {
    vi.clearAllMocks();

    mockTokenRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn((entity) => Promise.resolve(entity)),
      create: vi.fn((dto) => ({ tokenId: 'tok-id', ...dto })),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    mockUserRepo = {
      findOne: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    service = new NotificationTokensService(mockTokenRepo, mockUserRepo);
  });

  it('đăng ký token mới cho người dùng thành công và cập nhật fallback user.fcmToken', async () => {
    mockTokenRepo.findOne.mockResolvedValueOnce(null);

    const result = await service.registerToken(userId, {
      token: 'fcm-new-token-123',
      platform: 'ios',
      deviceIdentifier: 'uuid-device-1',
    });

    expect(result.token).toBe('fcm-new-token-123');
    expect(result.platform).toBe('ios');
    expect(mockTokenRepo.save).toHaveBeenCalled();
    expect(mockUserRepo.update).toHaveBeenCalledWith(userId, {
      fcmToken: 'fcm-new-token-123',
    });
  });

  it('kích hoạt lại token đã tồn tại và cập nhật thông tin thiết bị', async () => {
    const existing = {
      tokenId: 'existing-id',
      userId: 'old-user',
      token: 'fcm-reused-token',
      isActive: false,
      platform: 'android',
    };
    mockTokenRepo.findOne.mockResolvedValueOnce(existing);

    const result = await service.registerToken(userId, {
      token: 'fcm-reused-token',
      platform: 'android',
    });

    expect(result.userId).toBe(userId);
    expect(result.isActive).toBe(true);
    expect(mockUserRepo.update).toHaveBeenCalledWith(userId, {
      fcmToken: 'fcm-reused-token',
    });
  });

  it('trả về danh sách active tokens và fallback sang user.fcmToken nếu bảng token trống', async () => {
    // 1. Khi có tokens trong bảng notification_token
    mockTokenRepo.find.mockResolvedValueOnce([
      { token: 'tok-active-1' },
      { token: 'tok-active-2' },
    ]);

    const activeList = await service.getActiveTokens(userId);
    expect(activeList).toEqual(['tok-active-1', 'tok-active-2']);

    // 2. Khi bảng notification_token trống, fallback sang user.fcmToken
    mockTokenRepo.find.mockResolvedValueOnce([]);
    mockUserRepo.findOne.mockResolvedValueOnce({
      userId,
      fcmToken: 'legacy-fallback-token',
    });

    const fallbackList = await service.getActiveTokens(userId);
    expect(fallbackList).toEqual(['legacy-fallback-token']);
  });

  it('hủy kích hoạt token lỗi qua deactivateTokens', async () => {
    const affected = await service.deactivateTokens(['invalid-token-1', 'invalid-token-2']);
    expect(mockTokenRepo.update).toHaveBeenCalled();
    expect(mockUserRepo.update).toHaveBeenCalled();
    expect(affected).toBe(1);
  });
});
