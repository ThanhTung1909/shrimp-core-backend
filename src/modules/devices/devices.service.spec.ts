import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { FindDevicesQueryDto } from './dto/find-devices-query.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';

describe('DevicesService', () => {
  let service: DevicesService;
  let mockDeviceRepo: any;
  let mockPondRepo: any;
  let mockFarmRepo: any;
  let mockAssignmentRepo: any;
  let mockAlertRepo: any;

  const adminId = '00000000-0000-0000-0000-000000000000';
  const managerId = '11111111-1111-1111-1111-111111111111';
  const otherManagerId = '22222222-2222-2222-2222-222222222222';
  const farmerId = '33333333-3333-3333-3333-333333333333';
  const otherFarmerId = '44444444-4444-4444-4444-444444444444';
  const farmId = '55555555-5555-5555-5555-555555555555';
  const pondId = '66666666-6666-6666-6666-666666666666';
  const otherPondId = '77777777-7777-7777-7777-777777777777';
  const deviceId = '88888888-8888-8888-8888-888888888888';

  let mockQueryBuilder: any;

  beforeEach(() => {
    mockQueryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };

    mockDeviceRepo = {
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      create: vi.fn((data) => ({ ...data })),
      save: vi.fn((data) => Promise.resolve(data)),
      remove: vi.fn((data) => Promise.resolve(data)),
      createQueryBuilder: vi.fn(() => mockQueryBuilder),
    };

    mockPondRepo = {
      findOne: vi.fn(),
    };

    mockFarmRepo = {
      findOneBy: vi.fn(),
    };

    mockAssignmentRepo = {
      exist: vi.fn(),
    };

    mockAlertRepo = {
      create: vi.fn((data) => ({ ...data })),
      save: vi.fn((data) => Promise.resolve(data)),
    };

    service = new DevicesService(
      mockDeviceRepo,
      mockPondRepo,
      mockFarmRepo,
      mockAssignmentRepo,
      mockAlertRepo,
    );
  });

  describe('createDevice', () => {
    it('nên từ chối khi farmer cố gắng tạo thiết bị', async () => {
      const dto = {
        deviceName: 'ESP32 Ao 1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pondId,
      };

      await expect(
        service.createDevice(dto, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });

    it('nên từ chối khi manager tạo thiết bị không gắn ao nuôi', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      const dto = {
        deviceName: 'ESP32 Ao 1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
      };

      await expect(
        service.createDevice(dto as any, managerId, Role.MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên cho phép manager tạo thiết bị khi ao thuộc trang trại của mình', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);
      mockPondRepo.findOne.mockResolvedValue({
        pondId,
        farmId,
        farm: { farmId, ownerId: managerId },
      });

      const dto = {
        deviceName: 'ESP32 Ao 1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pondId,
        firmwareVersion: '1.0.0',
        status: DeviceStatus.OFFLINE,
      };

      const result = await service.createDevice(dto, managerId, Role.MANAGER);

      expect(result.deviceName).toBe(dto.deviceName);
      expect(result.macAddress).toBe(dto.macAddress);
      expect(mockDeviceRepo.save).toHaveBeenCalled();
    });

    it('nên từ chối khi manager tạo thiết bị vào ao thuộc trang trại của manager khác', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);
      mockPondRepo.findOne.mockResolvedValue({
        pondId,
        farmId,
        farm: { farmId, ownerId: otherManagerId },
      });
      mockFarmRepo.findOneBy.mockResolvedValue({ farmId, ownerId: otherManagerId });

      const dto = {
        deviceName: 'ESP32 Ao 1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pondId,
      };

      await expect(
        service.createDevice(dto, managerId, Role.MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên cho phép admin tạo thiết bị dù không gắn ao', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      const dto = {
        deviceName: 'ESP32 Tổng',
        macAddress: 'AA:BB:CC:DD:EE:01',
      };

      const result = await service.createDevice(dto as any, adminId, Role.ADMIN);

      expect(result.deviceName).toBe('ESP32 Tổng');
      expect(result.pondId).toBeNull();
      expect(mockDeviceRepo.save).toHaveBeenCalled();
    });

    it('nên từ chối khi MAC đã được đăng ký', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId,
        macAddress: 'AA:BB:CC:DD:EE:FF',
      });

      await expect(
        service.createDevice(
          {
            deviceName: 'ESP32 Ao 1',
            macAddress: 'AA:BB:CC:DD:EE:FF',
            pondId,
          },
          managerId,
          Role.MANAGER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });

    it('nên báo không tìm thấy ao khi pond không tồn tại', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);
      mockPondRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createDevice(
          {
            deviceName: 'ESP32 Ao 1',
            macAddress: 'AA:BB:CC:DD:EE:FF',
            pondId,
          },
          managerId,
          Role.MANAGER,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAllDevices', () => {
    it('nên trả về danh sách thiết bị có phân trang', async () => {
      const mockDevices = [
        { deviceId, deviceName: 'ESP32 1', status: DeviceStatus.ONLINE },
      ];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockDevices, 1]);

      const query: FindDevicesQueryDto = { page: 1, limit: 10 };
      const result = await service.findAllDevices(query, adminId, Role.ADMIN);

      expect(result.data).toEqual(mockDevices);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('nên giới hạn farmer chỉ nhìn thấy thiết bị thuộc ao của mình', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAllDevices({}, farmerId, Role.FARMER);

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'device.pond',
        'farmerPond',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('EXISTS (SELECT 1 FROM pond_farmer_assignments'),
        { currentUserId: farmerId },
      );
    });

    it('nên giới hạn manager chỉ nhìn thấy thiết bị thuộc trang trại của mình', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAllDevices({}, managerId, Role.MANAGER);

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'device.pond',
        'managerPond',
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('mFarm.owner_id = :currentUserId'),
        { currentUserId: managerId },
      );
    });
  });

  describe('findDeviceById', () => {
    it('nên cho phép admin truy cập bất kỳ thiết bị nào', async () => {
      const device = {
        deviceId,
        pondId: null,
        pond: null,
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);

      const result = await service.findDeviceById(deviceId, adminId, Role.ADMIN);
      expect(result).toBe(device);
    });

    it('nên cho phép manager truy cập thiết bị thuộc trang trại của mình', async () => {
      const device = {
        deviceId,
        pondId,
        pond: {
          pondId,
          farmId,
          farm: { farmId, ownerId: managerId },
        },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);

      const result = await service.findDeviceById(deviceId, managerId, Role.MANAGER);
      expect(result).toBe(device);
    });

    it('nên từ chối manager khi thiết bị không thuộc trang trại của mình', async () => {
      const device = {
        deviceId,
        pondId,
        pond: {
          pondId,
          farmId,
          farm: { farmId, ownerId: otherManagerId },
        },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockFarmRepo.findOneBy.mockResolvedValue({ farmId, ownerId: otherManagerId });

      await expect(
        service.findDeviceById(deviceId, managerId, Role.MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên từ chối manager khi thiết bị chưa được gán vào ao nuôi', async () => {
      const device = {
        deviceId,
        pondId: null,
        pond: null,
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);

      await expect(
        service.findDeviceById(deviceId, managerId, Role.MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên cho phép farmer truy cập thiết bị trong ao được phân công', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, userId: otherManagerId },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockAssignmentRepo.exist.mockResolvedValue(true);

      const result = await service.findDeviceById(deviceId, farmerId, Role.FARMER);
      expect(result).toBe(device);
    });

    it('nên từ chối farmer khi thiết bị không thuộc ao được phân công', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, userId: otherManagerId },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockAssignmentRepo.exist.mockResolvedValue(false);

      await expect(
        service.findDeviceById(deviceId, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('từ chối FARMER là legacy pond owner nhưng không có assignment', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId,
        pondId,
        pond: { pondId, userId: farmerId },
      });
      mockAssignmentRepo.exist.mockResolvedValue(false);

      await expect(
        service.findDeviceById(deviceId, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('mất quyền truy cập ngay khi assignment bị thu hồi', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId,
        pondId,
        pond: { pondId, userId: otherFarmerId },
      });
      mockAssignmentRepo.exist
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expect(service.findDeviceById(deviceId, farmerId, Role.FARMER)).resolves.toBeDefined();
      await expect(service.findDeviceById(deviceId, farmerId, Role.FARMER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateDevice', () => {
    it('nên từ chối farmer cập nhật thiết bị', async () => {
      await expect(
        service.updateDevice(deviceId, {}, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên cho phép manager cập nhật thiết bị trong trang trại của mình', async () => {
      const device = {
        deviceId,
        pondId,
        deviceName: 'Cũ',
        macAddress: 'AA:BB:CC:DD:EE:01',
        pond: { pondId, farmId, farm: { farmId, ownerId: managerId } },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);

      const dto: UpdateDeviceDto = { deviceName: 'Mới' };
      const result = await service.updateDevice(deviceId, dto, managerId, Role.MANAGER);

      expect(result.deviceName).toBe('Mới');
      expect(mockDeviceRepo.save).toHaveBeenCalled();
    });
  });

  describe('assignToPond', () => {
    it('nên từ chối farmer gán hoặc tháo thiết bị', async () => {
      await expect(
        service.assignToPond(deviceId, { pondId }, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên từ chối manager gỡ thiết bị khỏi ao nuôi thành null', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, farm: { farmId, ownerId: managerId } },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);

      await expect(
        service.assignToPond(deviceId, { pondId: null as any }, managerId, Role.MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('reportFault', () => {
    it('nên cho phép farmer báo cáo thiết bị hỏng và chuyển sang MAINTENANCE', async () => {
      const device = {
        deviceId,
        deviceName: 'Cảm biến pH',
        macAddress: '11:22:33:44:55:66',
        pondId,
        status: DeviceStatus.ONLINE,
        pond: { pondId, userId: farmerId },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockAssignmentRepo.exist.mockResolvedValue(true);

      const result = await service.reportFault(
        deviceId,
        { reason: 'Cảm biến mất tín hiệu' },
        farmerId,
        Role.FARMER,
      );

      expect(result.status).toBe(DeviceStatus.MAINTENANCE);
      expect(mockDeviceRepo.save).toHaveBeenCalled();
      expect(mockAlertRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'THIẾT BỊ HỎNG',
          alertLevel: AlertLevel.CRITICAL,
          status: AlertStatus.ACTIVE,
        }),
      );
      expect(mockAlertRepo.save).toHaveBeenCalled();
    });
  });

  describe('deleteDevice', () => {
    it('nên từ chối farmer xóa thiết bị', async () => {
      await expect(
        service.deleteDevice(deviceId, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên cho phép manager xóa thiết bị trong trang trại của mình', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, farmId, farm: { farmId, ownerId: managerId } },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);

      const res = await service.deleteDevice(deviceId, managerId, Role.MANAGER);
      expect(res.message).toContain('thành công');
      expect(mockDeviceRepo.remove).toHaveBeenCalledWith(device);
    });
  });
});
