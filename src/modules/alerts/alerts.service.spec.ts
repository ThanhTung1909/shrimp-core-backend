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

  beforeEach(() => {
    queryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };
    alertRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ alertId: 'alert-1', ...data })),
      findOne: vi.fn(),
      createQueryBuilder: vi.fn(() => queryBuilder),
    };
    service = new AlertsService(alertRepo);
  });

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

    expect(alertRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      pondId: 'pond-1',
      deviceId: 'device-1',
      metricName: 'pH',
      triggeredValue: 6.5,
      alertLevel: AlertLevel.WARNING,
      status: AlertStatus.ACTIVE,
      message: expect.stringContaining('thấp hơn ngưỡng 7'),
    }));
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

    expect(alertRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('cao hơn ngưỡng 8'),
    }));
  });

  it('filters alerts by pond owner before pagination for FARMER users', async () => {
    queryBuilder.getManyAndCount.mockResolvedValue([[{ alertId: 'owned-alert' }], 1]);

    const result = await service.findAll(
      { page: 2, limit: 10, deviceId: 'device-1', isResolved: false },
      'farmer-1',
      Role.FARMER,
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'pond.user_id = :currentUserId',
      { currentUserId: 'farmer-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'alert.device_id = :deviceId',
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
