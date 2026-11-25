import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PondsService } from './ponds.service.js';
import { Role } from '../../common/enums/role.enum.js';
import { PondStatus } from '../../common/enums/pond-status.enum.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { CreatePondDto } from './dto/create-pond.dto.js';
import { UpdatePondDto } from './dto/update-pond.dto.js';
import { FindPondsQueryDto } from './dto/find-ponds-query.dto.js';

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

    it('tên ao đã tồn tại -> ConflictException', async () => {
      mockPondRepo.findOne.mockResolvedValue({
        pondId: 'pond-existing',
        pondName: 'Ao 1',
      });

      await expect(
        service.createPond(
          { pondName: 'Ao 1', areaM2: 100, depthM: 2, shrimpDensity: 100 },
          'manager-1',
          Role.MANAGER,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPondRepo.save).not.toHaveBeenCalled();
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

    it('đổi sang tên của ao khác -> ConflictException', async () => {
      mockPondRepo.findOne
        .mockResolvedValueOnce({
          pondId: 'pond-1',
          userId: 'manager-1',
          pondName: 'Ao 1',
        })
        .mockResolvedValueOnce({ pondId: 'pond-2', pondName: 'Ao 2' });

      await expect(
        service.updatePond(
          'pond-1',
          { pondName: 'Ao 2' },
          'manager-1',
          Role.MANAGER,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPondRepo.save).not.toHaveBeenCalled();
    });

    it('giữ nguyên tên của chính ao -> hợp lệ', async () => {
      const pond = {
        pondId: 'pond-1',
        userId: 'manager-1',
        pondName: 'Ao 1',
      };
      mockPondRepo.findOne.mockResolvedValue(pond);

      await expect(
        service.updatePond(
          'pond-1',
          { pondName: 'Ao 1' },
          'manager-1',
          Role.MANAGER,
        ),
      ).resolves.toEqual(expect.objectContaining({ pondName: 'Ao 1' }));

      expect(mockPondRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('update capacity bằng 0 -> persist giá trị 0', async () => {
      const pond = {
        pondId: 'pond-1',
        userId: 'manager-1',
        pondName: 'Ao 1',
        capacity: 100,
      };
      mockPondRepo.findOne.mockResolvedValue(pond);

      const result = await service.updatePond(
        'pond-1',
        { capacity: 0 },
        'manager-1',
        Role.MANAGER,
      );

      expect(result.capacity).toBe(0);
      expect(mockPondRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ capacity: 0 }),
      );
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

  describe('Pond DTO validation', () => {
    const requiredPondFields = {
      pondName: 'Ao kiểm thử',
      areaM2: 100,
      depthM: 2,
      shrimpDensity: 100,
    };

    it('UpdatePondDto là partial của CreatePondDto', async () => {
      const dto = new UpdatePondDto();

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('location là optional và chấp nhận chuỗi hợp lệ', async () => {
      const dto = Object.assign(new CreatePondDto(), {
        ...requiredPondFields,
        location: 'Khu A',
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('location và capacity đều optional với CreatePondDto hợp lệ', async () => {
      const dto = Object.assign(new CreatePondDto(), requiredPondFields);

      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('capacity optional, chấp nhận 0 và số nguyên dương', async () => {
      const zeroCapacity = Object.assign(new CreatePondDto(), {
        ...requiredPondFields,
        capacity: 0,
      });
      const positiveCapacity = Object.assign(new CreatePondDto(), {
        ...requiredPondFields,
        capacity: 1000,
      });

      await expect(validate(zeroCapacity)).resolves.toHaveLength(0);
      await expect(validate(positiveCapacity)).resolves.toHaveLength(0);
      await expect(validate(new CreatePondDto())).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'capacity' }),
        ]),
      );
    });

    it('capacity từ chối số âm và số thập phân', async () => {
      const negativeCapacity = Object.assign(new UpdatePondDto(), {
        capacity: -1,
      });
      const decimalCapacity = Object.assign(new UpdatePondDto(), {
        capacity: 1.5,
      });

      expect(await validate(negativeCapacity)).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'capacity' })]),
      );
      expect(await validate(decimalCapacity)).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'capacity' })]),
      );
    });

    it('FindPondsQueryDto chấp nhận farmId UUID v4 hợp lệ và từ chối farmId không hợp lệ', async () => {
      const validDto = Object.assign(new FindPondsQueryDto(), {
        farmId: '11111111-1111-4111-8111-111111111111',
      });
      const emptyDto = new FindPondsQueryDto();
      const invalidDto = Object.assign(new FindPondsQueryDto(), {
        farmId: 'not-a-uuid',
      });

      await expect(validate(validDto)).resolves.toHaveLength(0);
      await expect(validate(emptyDto)).resolves.toHaveLength(0);
      expect(await validate(invalidDto)).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'farmId' })]),
      );
    });
  });

  describe('AQS-205 farmId filtering, farmerAssignments join & sanitization', () => {
    const farmId = '11111111-1111-4111-8111-111111111111';

    it('ADMIN/default findAllPonds lọc theo farmId, join farmerAssignments: { farmer: true } và ẩn trường nhạy cảm', async () => {
      const rawPond = {
        pondId: 'pond-1',
        pondName: 'Ao 1',
        farmId,
        user: {
          userId: 'owner-1',
          fullName: 'Owner One',
          passwordHash: 'secret-hash',
          fcmToken: 'secret-fcm',
          tokenVersion: 2,
          isLocked: false,
          mustChangePassword: true,
        },
        farmerAssignments: [
          {
            assignmentId: 'assign-1',
            pondId: 'pond-1',
            farmerId: 'farmer-1',
            farmer: {
              userId: 'farmer-1',
              fullName: 'Farmer One',
              passwordHash: 'farmer-hash',
              fcmToken: 'farmer-fcm',
              tokenVersion: 3,
              isLocked: true,
              mustChangePassword: false,
            },
          },
        ],
      };
      mockPondRepo.findAndCount.mockResolvedValue([[rawPond], 1]);

      const result = await service.findAllPonds({ farmId }, 'admin-1', Role.ADMIN);

      expect(mockPondRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { farmId },
          relations: expect.objectContaining({
            farmerAssignments: { farmer: true },
          }),
        }),
      );
      expect(result.data[0].user).toEqual({
        userId: 'owner-1',
        fullName: 'Owner One',
      });
      expect(result.data[0].farmerAssignments?.[0].farmer).toEqual({
        userId: 'farmer-1',
        fullName: 'Farmer One',
      });
    });

    it('findPondById luôn join farmerAssignments: { farmer: true } và ẩn trường nhạy cảm của farmer', async () => {
      mockPondRepo.findOne.mockResolvedValue({
        pondId: 'pond-1',
        userId: 'owner-1',
        user: {
          userId: 'owner-1',
          fullName: 'Owner One',
          passwordHash: 'hash',
          fcmToken: 'fcm',
          tokenVersion: 1,
          isLocked: false,
          mustChangePassword: false,
        },
        farmerAssignments: [
          {
            assignmentId: 'assign-1',
            farmerId: 'farmer-1',
            farmer: {
              userId: 'farmer-1',
              fullName: 'Farmer One',
              passwordHash: 'hash2',
              fcmToken: 'fcm2',
              tokenVersion: 4,
              isLocked: false,
              mustChangePassword: true,
            },
          },
        ],
      });

      const result = await service.findPondById('pond-1', 'admin-1', Role.ADMIN);

      expect(mockPondRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: expect.objectContaining({
            farmerAssignments: { farmer: true },
          }),
        }),
      );
      expect(result.user).toEqual({ userId: 'owner-1', fullName: 'Owner One' });
      expect(result.farmerAssignments?.[0].farmer).toEqual({
        userId: 'farmer-1',
        fullName: 'Farmer One',
      });
    });

    it('FARMER và MANAGER QueryBuilder paths đều áp dụng lọc farmId khi có assignmentRepo', async () => {
      const qb = {
        innerJoin: vi.fn().mockReturnThis(),
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const scopedPondRepo = {
        ...mockPondRepo,
        createQueryBuilder: vi.fn(() => qb),
      };
      const scopedService = new PondsService(
        scopedPondRepo as any,
        mockThresholdRepo,
        mockManualLogRepo,
        {} as any,
        {} as any,
        { exist: vi.fn() } as any,
      );

      await scopedService.findAllPonds({ farmId }, 'farmer-1', Role.FARMER);
      expect(qb.andWhere).toHaveBeenCalledWith('pond.farmId = :farmId', { farmId });

      qb.andWhere.mockClear();
      await scopedService.findAllPonds({ farmId }, 'manager-1', Role.MANAGER);
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('pond.farmerAssignments', 'farmerAssignments');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('farmerAssignments.farmer', 'farmer');
      expect(qb.andWhere).toHaveBeenCalledWith('pond.farmId = :farmId', { farmId });
    });
  });

  describe('createThresholdConfig', () => {
    it('tạo threshold với metricName đã tồn tại trên ao -> ConflictException', async () => {
      const mockPond = { pondId: 'pond-1', userId: 'farmer-1' };
      mockPondRepo.findOne.mockResolvedValue(mockPond);

      mockThresholdRepo.findOne = vi.fn().mockResolvedValue({
        configId: 'config-1',
        pondId: 'pond-1',
        metricName: 'pH',
      });

      await expect(
        service.createThresholdConfig(
          'pond-1',
          { metricName: 'pH', minValue: 7.0, maxValue: 8.5 },
          'farmer-1',
          Role.MANAGER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
