import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotificationPreferencesService,
  DEFAULT_PREFERENCES,
} from './notification-preferences.service.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { BadRequestException } from '@nestjs/common';

describe('NotificationPreferencesService (Scenarios 16 - 22)', () => {
  let service: NotificationPreferencesService;
  let mockPrefRepo: any;

  const userId = 'user-uuid-123';

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrefRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      save: vi.fn((entity) => Promise.resolve(entity)),
      create: vi.fn((dto) => ({ preferenceId: 'pref-id', ...dto })),
    };

    service = new NotificationPreferencesService(mockPrefRepo);
  });

  // Scenario 16: Get own preferences
  it('Scenario 16: Get own preferences - lấy danh sách cài đặt thông báo của chính user', async () => {
    const existingPrefs = [
      {
        preferenceId: 'p-1',
        userId,
        severity: AlertLevel.CRITICAL,
        channel: NotificationChannel.SMS,
        enabled: true,
      },
      {
        preferenceId: 'p-2',
        userId,
        severity: AlertLevel.WARNING,
        channel: NotificationChannel.SMS,
        enabled: false,
      },
    ];

    mockPrefRepo.find.mockResolvedValueOnce(existingPrefs);

    const result = await service.getUserPreferences(userId);

    expect(result).toEqual(existingPrefs);
    expect(mockPrefRepo.find).toHaveBeenCalledWith({
      where: { userId },
      order: { severity: 'ASC', channel: 'ASC' },
    });
  });

  // Scenario 17: Update own preferences
  it('Scenario 17: Update own preferences - cập nhật cài đặt thông báo thành công', async () => {
    const existingPref = {
      preferenceId: 'p-sms',
      userId,
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.SMS,
      enabled: true,
    };

    mockPrefRepo.findOne.mockResolvedValueOnce(existingPref);
    mockPrefRepo.find.mockResolvedValueOnce([
      { ...existingPref, enabled: false },
    ]);

    const updated = await service.updatePreferences(userId, {
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.SMS,
      enabled: false,
    });

    expect(mockPrefRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: AlertLevel.CRITICAL,
        channel: NotificationChannel.SMS,
        enabled: false,
      }),
    );
    expect(updated).toBeDefined();
  });

  // Scenario 18: Invalid severity
  it('Scenario 18: Invalid severity - từ chối mức độ cảnh báo không hợp lệ', async () => {
    await expect(
      service.updatePreferences(userId, {
        severity: 'INVALID_SEVERITY' as any,
        channel: NotificationChannel.SMS,
        enabled: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // Scenario 19: Invalid channel
  it('Scenario 19: Invalid channel - từ chối kênh thông báo không hợp lệ', async () => {
    await expect(
      service.updatePreferences(userId, {
        severity: AlertLevel.CRITICAL,
        channel: 'TELEGRAM' as any,
        enabled: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // Scenario 20: Unauthorized update / User ownership isolation
  it('Scenario 20: Unauthorized update - chỉ cho phép cập nhật preferences của chính user_id xác thực', async () => {
    const userA = 'user-a-uuid';
    const userB = 'user-b-uuid';

    mockPrefRepo.findOne.mockResolvedValueOnce(null);
    mockPrefRepo.find.mockResolvedValueOnce([]);

    await service.updatePreferences(userA, {
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.EMAIL,
      enabled: false,
    });

    // Xác nhận repo chỉ thao tác với userA, không thể ảnh hưởng userB
    expect(mockPrefRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userA }),
    );
  });

  // Scenario 21: Duplicate prevention
  it('Scenario 21: Duplicate prevention - cập nhật bản ghi cũ thay vì tạo thêm dòng trùng lặp', async () => {
    const existingRow = {
      preferenceId: 'pref-row-1',
      userId,
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.FCM,
      enabled: true,
    };

    mockPrefRepo.findOne.mockResolvedValueOnce(existingRow);
    mockPrefRepo.find.mockResolvedValueOnce([existingRow]);

    await service.updatePreferences(userId, {
      severity: AlertLevel.CRITICAL,
      channel: NotificationChannel.FCM,
      enabled: false,
    });

    // Không gọi repo.create, chỉ gọi save trên existingRow
    expect(mockPrefRepo.create).not.toHaveBeenCalled();
    expect(mockPrefRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ preferenceId: 'pref-row-1', enabled: false }),
    );
  });

  // Scenario 22: Default preferences
  it('Scenario 22: Default preferences - trả về cấu hình mặc định (CRITICAL: All channels on, WARNING: Push only)', async () => {
    mockPrefRepo.find.mockResolvedValueOnce([]); // Chưa có trong DB
    mockPrefRepo.save.mockImplementationOnce((entities: any) => Promise.resolve(entities));

    const defaults = await service.getUserPreferences(userId);

    expect(defaults).toHaveLength(DEFAULT_PREFERENCES.length);

    // Kiểm tra chính sách mặc định:
    // CRITICAL: FCM, SMS, EMAIL đều true
    const criticalSMS = defaults.find(
      (p) => p.severity === AlertLevel.CRITICAL && p.channel === NotificationChannel.SMS,
    );
    expect(criticalSMS?.enabled).toBe(true);

    const criticalEmail = defaults.find(
      (p) => p.severity === AlertLevel.CRITICAL && p.channel === NotificationChannel.EMAIL,
    );
    expect(criticalEmail?.enabled).toBe(true);

    // WARNING: FCM = true, SMS = false, EMAIL = false
    const warningSMS = defaults.find(
      (p) => p.severity === AlertLevel.WARNING && p.channel === NotificationChannel.SMS,
    );
    expect(warningSMS?.enabled).toBe(false);

    const warningEmail = defaults.find(
      (p) => p.severity === AlertLevel.WARNING && p.channel === NotificationChannel.EMAIL,
    );
    expect(warningEmail?.enabled).toBe(false);
  });
});
