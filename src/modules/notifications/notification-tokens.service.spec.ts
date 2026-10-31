import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationTokensService } from './notification-tokens.service.js';
import { ForbiddenException } from '@nestjs/common';

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

  it('allows user A to register a new token without using the legacy fallback', async () => {
    mockTokenRepo.findOne.mockResolvedValueOnce(null);

    const result = await service.registerToken(userId, {
      token: 'fcm-new-token-123',
      platform: 'ios',
      deviceIdentifier: 'uuid-device-1',
    });

    expect(result.token).toBe('fcm-new-token-123');
    expect(result.platform).toBe('ios');
    expect(mockTokenRepo.save).toHaveBeenCalled();
    expect(mockUserRepo.update).toHaveBeenCalledWith(
      { fcmToken: 'fcm-new-token-123' },
      { fcmToken: null },
    );
  });

  it('allows the same owner to register the same token idempotently', async () => {
    const existing = {
      tokenId: 'existing-id',
      userId,
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
    expect(mockUserRepo.update).toHaveBeenCalledWith(
      { fcmToken: 'fcm-reused-token' },
      { fcmToken: null },
    );
  });

  it('rejects user B attempting to claim an active token owned by user A', async () => {
    mockTokenRepo.findOne.mockResolvedValueOnce({
      tokenId: 'owned-token', userId: 'user-a', token: 'fcm-owned-token', isActive: true,
    });
    await expect(service.registerToken('user-b', { token: 'fcm-owned-token' }))
      .rejects.toThrow(ForbiddenException);
    expect(mockTokenRepo.save).not.toHaveBeenCalled();
  });

  it('maps a concurrent global-token constraint conflict to the ownership denial', async () => {
    mockTokenRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tokenId: 'winning-token', userId: 'user-a', token: 'fcm-race-token', isActive: true,
      });
    mockTokenRepo.save.mockRejectedValueOnce({ code: '23505' });

    await expect(service.registerToken('user-b', { token: 'fcm-race-token' }))
      .rejects.toThrow(ForbiddenException);
  });

  it('allows a handoff only after the previous owner explicitly unregistered the token', async () => {
    const inactive = {
      tokenId: 'handoff-token', userId: 'user-a', token: 'fcm-handoff-token', isActive: false,
    };
    mockTokenRepo.findOne.mockResolvedValueOnce(inactive);
    const result = await service.registerToken('user-b', { token: 'fcm-handoff-token' });
    expect(result.userId).toBe('user-b');
    expect(mockUserRepo.update).toHaveBeenCalledWith(
      { userId: 'user-a', fcmToken: 'fcm-handoff-token' },
      { fcmToken: null },
    );
  });

  it('uses only active notification_token rows and never a stale users.fcmToken fallback', async () => {
    // 1. Khi có tokens trong bảng notification_token
    mockTokenRepo.find.mockResolvedValueOnce([
      { token: 'tok-active-1' },
      { token: 'tok-active-2' },
    ]);

    const activeList = await service.getActiveTokens(userId);
    expect(activeList).toEqual(['tok-active-1', 'tok-active-2']);

    // 2. Legacy fallback is intentionally ignored after the ownership fix.
    mockTokenRepo.find.mockResolvedValueOnce([]);
    const fallbackList = await service.getActiveTokens(userId);
    expect(fallbackList).toEqual([]);
  });

  it('hủy kích hoạt token lỗi qua deactivateTokens', async () => {
    const affected = await service.deactivateTokens(['invalid-token-1', 'invalid-token-2']);
    expect(mockTokenRepo.update).toHaveBeenCalled();
    expect(mockUserRepo.update).toHaveBeenCalled();
    expect(affected).toBe(1);
  });
});
