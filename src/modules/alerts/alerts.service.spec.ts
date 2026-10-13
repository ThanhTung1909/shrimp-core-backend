import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlertsService } from './alerts.service.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';

describe('AlertsService', () => {
  let service: AlertsService;
  let mockAlertRepo: any;
  let mockDispatcher: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAlertRepo = {
      create: vi.fn((data) => ({ alertId: 'alert-1', ...data })),
      save: vi.fn((data) => Promise.resolve(data)),
      findOne: vi.fn(),
      createQueryBuilder: vi.fn(() => ({
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      })),
    };

    mockDispatcher = {
      dispatchAlert: vi.fn().mockResolvedValue(undefined),
    };

    service = new AlertsService(mockAlertRepo, mockDispatcher);
  });

  it('tạo cảnh báo mới và tự động kích hoạt notification dispatch', async () => {
    const alertData = {
      pondId: 'pond-123',
      metricName: 'dissolvedOxygen',
      triggeredValue: 2.5,
      alertLevel: AlertLevel.CRITICAL,
      status: AlertStatus.ACTIVE,
    };

    const result = await service.createAlert(alertData);

    expect(result.alertId).toBe('alert-1');
    expect(mockAlertRepo.save).toHaveBeenCalled();
    expect(mockDispatcher.dispatchAlert).toHaveBeenCalledWith(result);
  });

  it('resolve alert và cập nhật trạng thái RESOLVED', async () => {
    mockAlertRepo.findOne.mockResolvedValueOnce({
      alertId: 'alert-1',
      status: AlertStatus.ACTIVE,
    });

    const result = await service.resolveAlert('alert-1', 'user-tech-1', {
      resolutionNote: 'Đã sục khí tăng DO',
    });

    expect(result.status).toBe(AlertStatus.RESOLVED);
    expect(result.resolvedById).toBe('user-tech-1');
    expect(result.resolutionNote).toBe('Đã sục khí tăng DO');
  });
});
