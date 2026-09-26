import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PondsService } from './ponds.service.js';
import { Role } from '../../common/enums/role.enum.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('PondsService', () => {
  let service: PondsService;
  let mockPondRepo: any;
  let mockThresholdRepo: any;
  let mockManualLogRepo: any;

  beforeEach(() => {
    mockPondRepo = {
      create: vi.fn((data) => data),
      save: vi.fn((data) => Promise.resolve({ pondId: 'pond-123', ...data })),
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      remove: vi.fn((data) => Promise.resolve(data)),
    };

    mockThresholdRepo = {};
    mockManualLogRepo = {};

    service = new PondsService(
      mockPondRepo,
      mockThresholdRepo,
      mockManualLogRepo,
    );
  });

  describe('createPond (A. CREATE)', () => {
    it('FARMER tạo pond cho chính mình -> thành công', async () => {
      const dto = { pondName: 'Ao cua toi', areaM2: 100, depthM: 2, shrimpDensity: 100 };
      const currentUserId = 'farmer-1';

      const result = await service.createPond(dto, currentUserId, Role.FARMER);

      expect(result).toBeDefined();
      expect(result.userId).toBe(currentUserId);
      expect(mockPondRepo.save).toHaveBeenCalled();
    });

    it('FARMER cố tạo pond cho user khác -> bị ép về chính mình (targetUserId = currentUserId)', async () => {
      const dto = { pondName: 'Ao cua toi', areaM2: 100, depthM: 2, shrimpDensity: 100, userId: 'other-user' };
      const currentUserId = 'farmer-1';

      const result = await service.createPond(dto, currentUserId, Role.FARMER);

      expect(result.userId).toBe(currentUserId);
      expect(result.userId).not.toBe('other-user');
    });

    it('MANAGER tạo pond -> thành công (có thể truyền userId cụ thể)', async () => {
      const dto = { pondName: 'Ao tao cho user', areaM2: 100, depthM: 2, shrimpDensity: 100, userId: 'farmer-2' };
      const currentUserId = 'manager-1';

      const result = await service.createPond(dto, currentUserId, Role.MANAGER);

      expect(result.userId).toBe('farmer-2');
    });
  });

  describe('findAllPonds (B. GET LIST)', () => {
    it('FARMER chỉ lấy được pond của chính mình', async () => {
      mockPondRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllPonds({}, 'farmer-1', Role.FARMER);

      expect(mockPondRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'farmer-1' },
        })
      );
    });

    it('MANAGER có thể lấy toàn bộ pond (không truyền userId)', async () => {
      mockPondRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllPonds({}, 'manager-1', Role.MANAGER);

      expect(mockPondRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        })
      );
    });

    it('MANAGER có thể filter theo user', async () => {
      mockPondRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllPonds({ userId: 'farmer-target' }, 'manager-1', Role.MANAGER);

      expect(mockPondRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'farmer-target' },
        })
      );
    });
  });

  describe('findPondById (C. GET DETAIL)', () => {
    it('Pond không tồn tại -> throw NotFoundException', async () => {
      mockPondRepo.findOne.mockResolvedValue(null);

      await expect(service.findPondById('invalid-id', 'user-1', Role.FARMER))
        .rejects.toThrow(NotFoundException);
    });

    it('FARMER xem pond của mình -> thành công', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-1' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      const result = await service.findPondById('pond-1', 'farmer-1', Role.FARMER);

      expect(result).toEqual(mockPond);
    });

    it('FARMER xem pond của người khác -> throw ForbiddenException', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-other' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      await expect(service.findPondById('pond-1', 'farmer-1', Role.FARMER))
        .rejects.toThrow(ForbiddenException);
    });

    it('MANAGER xem pond của người khác -> thành công', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-other' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      const result = await service.findPondById('pond-1', 'manager-1', Role.MANAGER);

      expect(result).toEqual(mockPond);
    });
  });

  describe('updatePond (D. UPDATE)', () => {
    it('Pond không tồn tại -> NotFoundException', async () => {
      mockPondRepo.findOne.mockResolvedValue(null);

      await expect(service.updatePond('invalid', {}, 'user', Role.FARMER))
        .rejects.toThrow(NotFoundException);
    });

    it('FARMER update pond của mình -> thành công', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-1', pondName: 'Old' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      const result = await service.updatePond('pond-1', { pondName: 'New' }, 'farmer-1', Role.FARMER);

      expect(result.pondName).toBe('New');
      expect(mockPondRepo.save).toHaveBeenCalledWith(expect.objectContaining({ pondName: 'New' }));
    });

    it('FARMER update pond của người khác -> ForbiddenException', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-other' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      await expect(service.updatePond('pond-1', {}, 'farmer-1', Role.FARMER))
        .rejects.toThrow(ForbiddenException);
    });

    it('MANAGER update pond -> thành công, có thể thay đổi owner (userId)', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-old' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      const result = await service.updatePond('pond-1', { userId: 'farmer-new' }, 'manager-1', Role.MANAGER);

      expect(result.userId).toBe('farmer-new');
      expect(mockPondRepo.save).toHaveBeenCalled();
    });
  });

  describe('deletePond (E. DELETE)', () => {
    it('Pond không tồn tại -> NotFoundException', async () => {
      mockPondRepo.findOne.mockResolvedValue(null);

      await expect(service.deletePond('invalid', 'user', Role.FARMER))
        .rejects.toThrow(NotFoundException);
    });

    it('FARMER xóa pond của mình -> thành công', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-1' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      await service.deletePond('pond-1', 'farmer-1', Role.FARMER);

      expect(mockPondRepo.remove).toHaveBeenCalledWith(mockPond);
    });

    it('FARMER xóa pond của người khác -> ForbiddenException', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-other' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      await expect(service.deletePond('pond-1', 'farmer-1', Role.FARMER))
        .rejects.toThrow(ForbiddenException);
    });

    it('MANAGER xóa pond (kể cả của người khác) -> thành công', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-other' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      await service.deletePond('pond-1', 'manager-1', Role.MANAGER);

      expect(mockPondRepo.remove).toHaveBeenCalledWith(mockPond);
    });
  });
});
