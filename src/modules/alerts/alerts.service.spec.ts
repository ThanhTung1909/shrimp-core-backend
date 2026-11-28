import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { AlertsService } from './alerts.service.js';
import { QueryAlertDto } from './dto/query-alert.dto.js';

describe('AlertsService', () => {
  let service: AlertsService;
  let alertRepo: any;
  let queryBuilder: any;
  let mockRedisService: any;
  let mockDispatcher: any;

  beforeEach(() => {
    vi.clearAllMocks();

    queryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
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
      manager: { query: vi.fn() },
    };
    mockRedisService = { publish: vi.fn().mockResolvedValue(1) };
    mockDispatcher = { dispatchAlert: vi.fn().mockResolvedValue(undefined) };
    service = new AlertsService(alertRepo, mockRedisService, mockDispatcher);
  });

  it('uses the dispatcher fallback only when publishing the stored alert fails', async () => {
    mockRedisService.publish.mockRejectedValueOnce(new Error('Redis unavailable'));

    const result = await service.createAlert({ pondId: 'pond-1' });

    expect(mockDispatcher.dispatchAlert).toHaveBeenCalledWith(result);
  });

  describe('createAlert', () => {
    it('persists an alert before publishing its canonical notification event', async () => {
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
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        'alert:triggered',
        JSON.stringify({ pondId: 'pond-123', alert: result }),
      );
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
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        'alert:triggered',
        JSON.stringify({ pondId: 'pond-1', alert: result }),
      );
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
        'EXISTS (SELECT 1 FROM pond_farmer_assignments pfa WHERE pfa.pond_id = pond.pond_id AND pfa.farmer_id = :currentUserId)',
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

    it('limits a MANAGER list to Farms they own, not a matching pond user ID', async () => {
      await service.findAll({ pondId: 'foreign-pond' }, 'manager-1', Role.MANAGER);

      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'farms',
        'farm',
        'farm.farm_id = pond.farm_id',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'farm.owner_id = :currentUserId',
        { currentUserId: 'manager-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.pond_id = :pondId',
        { pondId: 'foreign-pond' },
      );
    });

    it('applies pondId, startDate, and inclusive date-only endDate filters', async () => {
      const pondId = '11111111-1111-4111-8111-111111111111';

      await service.findAll(
        {
          pondId,
          startDate: '2026-11-01',
          endDate: '2026-11-25',
        },
        'admin-1',
        Role.ADMIN,
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.pond_id = :pondId',
        { pondId },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.createdAt >= :startDate',
        { startDate: new Date('2026-11-01') },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.createdAt <= :endDate',
        { endDate: new Date('2026-11-25T23:59:59.999Z') },
      );
    });

    it('uses exact Date instance when endDate includes a full ISO timestamp', async () => {
      const isoEndDate = '2026-11-25T10:30:00.000Z';

      await service.findAll(
        { endDate: isoEndDate },
        'admin-1',
        Role.ADMIN,
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'alert.createdAt <= :endDate',
        { endDate: new Date(isoEndDate) },
      );
    });
  });

  describe('QueryAlertDto validation', () => {
    it('accepts valid pondId, startDate, and endDate', async () => {
      const dto = Object.assign(new QueryAlertDto(), {
        pondId: '11111111-1111-4111-8111-111111111111',
        startDate: '2026-11-01',
        endDate: '2026-11-25T23:59:59.999Z',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('accepts seeded canonical UUIDs without RFC-4122 version bits', async () => {
      const dto = Object.assign(new QueryAlertDto(), {
        pondId: '22222222-2222-2222-2222-222222222201',
        deviceId: '33333333-3333-4333-a333-333333333301',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('rejects invalid pondId, startDate, and endDate', async () => {
      const dto = Object.assign(new QueryAlertDto(), {
        pondId: 'invalid-uuid',
        startDate: 'not-a-date',
        endDate: 'still-not-a-date',
      });

      const errors = await validate(dto);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'pondId' }),
          expect.objectContaining({ property: 'startDate' }),
          expect.objectContaining({ property: 'endDate' }),
        ]),
      );
    });
  });

  describe('resolveAlert', () => {
    it('resolves a FARMER alert only with a current pond assignment', async () => {
      const alert = {
        alertId: 'alert-1',
        pond: { pondId: 'pond-1', userId: 'farmer-1' },
        status: AlertStatus.ACTIVE,
      };
      alertRepo.findOne.mockResolvedValue(alert);
      alertRepo.manager.query.mockResolvedValue([{ exists: 1 }]);

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

    it('rejects a FARMER who is the legacy pond owner but has no assignment', async () => {
      alertRepo.findOne.mockResolvedValue({
        alertId: 'other-alert',
        pond: { pondId: 'pond-1', userId: 'farmer-1' },
      });
      alertRepo.manager.query.mockResolvedValue([]);

      await expect(
        service.resolveAlert('other-alert', 'farmer-1', {}, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(alertRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a MANAGER whose user ID matches the pond but who does not own its Farm', async () => {
      alertRepo.findOne.mockResolvedValue({
        alertId: 'foreign-alert',
        pond: { pondId: 'pond-1', farmId: 'farm-b', userId: 'manager-1' },
      });
      alertRepo.manager.query.mockResolvedValue([]);

      await expect(
        service.resolveAlert('foreign-alert', 'manager-1', {}, Role.MANAGER),
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
