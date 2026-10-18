import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { AlertsService } from './alerts.service.js';

describe('AlertsService', () => {
  let service: AlertsService;
  let alertRepo: any;
  let queryBuilder: any;
  let mockDispatcher: any;

  beforeEach(() => {
    vi.clearAllMocks();

    queryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[{ alertId: 'alert-1' }], 1]),
    };
    alertRepo = {
      create: vi.fn((data) => ({ alertId: 'alert-1', ...data })),
      save: vi.fn(async (data) => ({ alertId: 'alert-1', ...data })),
      findOne: vi.fn(),
      createQueryBuilder: vi.fn(() => queryBuilder),
    };
    mockDispatcher = {
      dispatchAlert: vi.fn().mockResolvedValue(undefined),
    };
    service = new AlertsService(alertRepo, mockDispatcher);
  });

  describe('createAlert', () => {
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
      expect(alertRepo.save).toHaveBeenCalled();
      expect(mockDispatcher.dispatchAlert).toHaveBeenCalledWith(result);
    });
  });

  describe('createThresholdAlert', () => {
    it('creates an active WARNING alert for a low threshold violation', async () => {
      const result = await service.createThresholdAlert({
        pondId: 'pond-1',
        deviceId: 'device-1',
        metricName: 'pH',
        triggeredValue: 6.5,
        minValue: 7,
        maxValue: 8.5,
        direction: 'LOW',
      });

      expect(alertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId: 'pond-1',
          deviceId: 'device-1',
          metricName: 'pH',
          triggeredValue: 6.5,
          alertLevel: AlertLevel.WARNING,
          status: AlertStatus.ACTIVE,
          message: expect.stringContaining('thấp hơn ngưỡng 7'),
        }),
      );
      expect(result.alertId).toBe('alert-1');
    });

    it('describes high threshold violations in Vietnamese', async () => {
      await service.createThresholdAlert({
        pondId: 'pond-1',
        deviceId: 'device-1',
        metricName: 'DO',
        triggeredValue: 10,
        minValue: 4,
        maxValue: 8,
        direction: 'HIGH',
      });

      expect(alertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('cao hơn ngưỡng 8'),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('sắp xếp theo alert.createdAt DESC, phân trang chính xác và lọc theo FARMER', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[{ alertId: 'owned-alert' }], 1]);

      const result = await service.findAll(
        { page: 2, limit: 10, deviceId: 'device-1', isResolved: false },
        'farmer-1',
        Role.FARMER,
      );

      expect(alertRepo.createQueryBuilder).toHaveBeenCalledWith('alert');
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('alert.pond', 'pond');
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('alert.device', 'device');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'pond.user_id = :currentUserId',
        { currentUserId: 'farmer-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.deviceId = :deviceId',
        { deviceId: 'device-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.status = :status',
        { status: AlertStatus.ACTIVE },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('alert.createdAt', 'DESC');
      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({ data: [{ alertId: 'owned-alert' }], total: 1 });
    });

    it('does not add a pond-owner restriction for ADMIN users', async () => {
      await service.findAll({}, 'admin-1', Role.ADMIN);

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        'pond.user_id = :currentUserId',
        expect.anything(),
      );
    });
  });

  describe('resolveAlert', () => {
    it('resolves an owned FARMER alert using the authenticated user ID', async () => {
      const alert = {
        alertId: 'alert-1',
        pond: { userId: 'farmer-1' },
        status: AlertStatus.ACTIVE,
      };
      alertRepo.findOne.mockResolvedValue(alert);

      await service.resolveAlert(
        'alert-1',
        'farmer-1',
        { resolutionNote: 'Đã xử lý' },
        Role.FARMER,
      );

      expect(alertRepo.findOne).toHaveBeenCalledWith({
        where: { alertId: 'alert-1' },
        relations: { pond: true },
      });
      expect(alertRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AlertStatus.RESOLVED,
          resolvedById: 'farmer-1',
          resolvedAt: expect.any(Date),
          resolutionNote: 'Đã xử lý',
        }),
      );
    });

    it('rejects a FARMER resolving an alert owned by another user without saving', async () => {
      alertRepo.findOne.mockResolvedValue({
        alertId: 'other-alert',
        pond: { userId: 'farmer-2' },
      });

      await expect(
        service.resolveAlert('other-alert', 'farmer-1', {}, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(alertRepo.save).not.toHaveBeenCalled();
    });

    it('returns 404 when resolving an alert that does not exist', async () => {
      alertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveAlert('missing-alert', 'farmer-1', {}, Role.FARMER),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(alertRepo.save).not.toHaveBeenCalled();
    });
  });
});
