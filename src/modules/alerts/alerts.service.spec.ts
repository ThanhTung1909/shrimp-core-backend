import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertsService } from './alerts.service.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { Repository } from 'typeorm';
import { Alert } from './entities/alert.entity.js';

describe('AlertsService', () => {
  let service: AlertsService;
  let mockAlertRepo: Partial<Repository<Alert>>;
  let mockQueryBuilder: any;

  beforeEach(() => {
    mockQueryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[{ alertId: 'alert-1' }], 1]),
    };

    mockAlertRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
      findOne: vi.fn(),
      save: vi.fn(),
    };

    service = new AlertsService(mockAlertRepo as Repository<Alert>);
  });

  describe('findAll', () => {
    it('nên sắp xếp theo alert.createdAt DESC và phân trang chính xác', async () => {
      const result = await service.findAll({
        page: 2,
        limit: 10,
        deviceId: 'dev-123',
        isResolved: false,
      });

      expect(mockAlertRepo.createQueryBuilder).toHaveBeenCalledWith('alert');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('alert.pond', 'pond');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('alert.device', 'device');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('alert.deviceId = :deviceId', { deviceId: 'dev-123' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('alert.status = :status', { status: AlertStatus.ACTIVE });
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('alert.createdAt', 'DESC');
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
      expect(result).toEqual({ data: [{ alertId: 'alert-1' }], total: 1 });
    });
  });
});
