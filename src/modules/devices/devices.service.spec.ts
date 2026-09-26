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

describe('DevicesService', () => {
  let service: DevicesService;
  let mockDeviceRepo: any;
  let mockPondRepo: any;

  const farmerId = '11111111-1111-1111-1111-111111111111';
  const otherFarmerId = '22222222-2222-2222-2222-222222222222';
  const pondId = '33333333-3333-3333-3333-333333333333';
  const otherPondId = '44444444-4444-4444-4444-444444444444';
  const deviceId = '55555555-5555-5555-5555-555555555555';

  beforeEach(() => {
    mockDeviceRepo = {
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      create: vi.fn((data) => ({ ...data })),
      save: vi.fn((data) => Promise.resolve(data)),
      remove: vi.fn((data) => Promise.resolve(data)),
    };

    mockPondRepo = {
      findOne: vi.fn(),
    };

    service = new DevicesService(mockDeviceRepo, mockPondRepo);
  });

  describe('createDevice', () => {
    it('nên tạo thiết bị khi farmer sở hữu ao', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);
      mockPondRepo.findOne.mockResolvedValue({
        pondId,
        userId: farmerId,
      });

      const dto = {
        deviceName: 'ESP32 Ao 1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pondId,
        firmwareVersion: '1.0.0',
        status: DeviceStatus.OFFLINE,
      };

      const result = await service.createDevice(
        dto,
        farmerId,
        Role.FARMER,
      );

      expect(result).toEqual(dto);
      expect(mockDeviceRepo.create).toHaveBeenCalledWith(dto);
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(dto);
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
          farmerId,
          Role.FARMER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPondRepo.findOne).not.toHaveBeenCalled();
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
          farmerId,
          Role.FARMER,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });

    it('nên từ chối farmer gắn thiết bị vào ao của farmer khác', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);
      mockPondRepo.findOne.mockResolvedValue({
        pondId,
        userId: otherFarmerId,
      });

      await expect(
        service.createDevice(
          {
            deviceName: 'ESP32 Ao khác',
            macAddress: '11:22:33:44:55:66',
            pondId,
          },
          farmerId,
          Role.FARMER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAllDevices', () => {
    it('nên trả về danh sách thiết bị có phân trang', async () => {
      const devices = [
        {
          deviceId,
          deviceName: 'ESP32 Ao 1',
          pondId,
          pond: { pondId, userId: farmerId },
        },
      ];

      mockDeviceRepo.findAndCount.mockResolvedValue([devices, 1]);

      const query: FindDevicesQueryDto = {
        page: 1,
        limit: 10,
      };

      const result = await service.findAllDevices(
        query,
        farmerId,
        Role.FARMER,
      );

      expect(result).toEqual({
        data: devices,
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      expect(mockDeviceRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: { pond: true },
          order: { deviceName: 'ASC' },
          skip: 0,
          take: 10,
        }),
      );
    });

    it('nên giới hạn farmer chỉ nhìn thấy thiết bị thuộc ao của mình', async () => {
      mockDeviceRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllDevices(
        {
          page: 2,
          limit: 5,
        },
        farmerId,
        Role.FARMER,
      );

      expect(mockDeviceRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            pond: { userId: farmerId },
          },
          skip: 5,
          take: 5,
        }),
      );
    });

    it('nên hỗ trợ tìm kiếm theo tên thiết bị', async () => {
      mockDeviceRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllDevices(
        {
          page: 1,
          limit: 10,
          search: 'ESP32',
        },
        farmerId,
        Role.FARMER,
      );

      const call = mockDeviceRepo.findAndCount.mock.calls[0][0];

      expect(call.where).toHaveLength(2);
      expect(call.where[0]).toEqual(
        expect.objectContaining({
          pond: { userId: farmerId },
          deviceName: expect.anything(),
        }),
      );
      expect(call.where[1]).toEqual(
        expect.objectContaining({
          pond: { userId: farmerId },
          macAddress: expect.anything(),
        }),
      );
    });
  });

  describe('findDeviceById', () => {
    it('nên trả về thiết bị khi farmer sở hữu ao', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, userId: farmerId },
      };

      mockDeviceRepo.findOne.mockResolvedValue(device);

      const result = await service.findDeviceById(
        deviceId,
        farmerId,
        Role.FARMER,
      );

      expect(result).toBe(device);
      expect(mockDeviceRepo.findOne).toHaveBeenCalledWith({
        where: { deviceId },
        relations: { pond: true },
      });
    });

    it('nên từ chối IDOR khi farmer truy cập thiết bị của farmer khác', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId,
        pondId,
        pond: { pondId, userId: otherFarmerId },
      });

      await expect(
        service.findDeviceById(deviceId, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('nên báo không tìm thấy khi device không tồn tại', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findDeviceById(deviceId, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('manager có thể truy cập thiết bị không thuộc farmer của mình', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, userId: otherFarmerId },
      };

      mockDeviceRepo.findOne.mockResolvedValue(device);

      const result = await service.findDeviceById(
        deviceId,
        farmerId,
        Role.MANAGER,
      );

      expect(result).toBe(device);
    });
  });

  describe('updateDevice', () => {
    it('nên cập nhật thông tin thiết bị', async () => {
      const device = {
        deviceId,
        pondId,
        deviceName: 'Tên cũ',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        firmwareVersion: '1.0.0',
        status: DeviceStatus.OFFLINE,
        lastActiveAt: null,
        pond: { pondId, userId: farmerId },
      };

      mockDeviceRepo.findOne
        .mockResolvedValueOnce(device)
        .mockResolvedValueOnce(null);

      const dto: UpdateDeviceDto = {
        deviceName: 'Tên mới',
        macAddress: '11:22:33:44:55:66',
        firmwareVersion: '2.0.0',
        status: DeviceStatus.ONLINE,
        lastActiveAt: '2026-09-19T10:00:00.000Z',
      };

      const result = await service.updateDevice(
        deviceId,
        dto,
        farmerId,
        Role.FARMER,
      );

      expect(result.deviceName).toBe('Tên mới');
      expect(result.macAddress).toBe(dto.macAddress);
      expect(result.firmwareVersion).toBe(dto.firmwareVersion);
      expect(result.status).toBe(DeviceStatus.ONLINE);
      expect(result.lastActiveAt).toEqual(new Date(dto.lastActiveAt));
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(device);
    });

    it('nên từ chối khi MAC mới đã thuộc thiết bị khác', async () => {
      const device = {
        deviceId,
        pondId,
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pond: { pondId, userId: farmerId },
      };

      mockDeviceRepo.findOne
        .mockResolvedValueOnce(device)
        .mockResolvedValueOnce({
          deviceId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          macAddress: '11:22:33:44:55:66',
        });

      await expect(
        service.updateDevice(
          deviceId,
          { macAddress: '11:22:33:44:55:66' },
          farmerId,
          Role.FARMER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });

    it('nên cho phép farmer chuyển thiết bị sang ao khác của chính mình', async () => {
      const device = {
        deviceId,
        pondId,
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pond: { pondId, userId: farmerId },
      };

      mockDeviceRepo.findOne.mockResolvedValueOnce(device);
      mockPondRepo.findOne.mockResolvedValue({
        pondId: otherPondId,
        userId: farmerId,
      });

      const result = await service.updateDevice(
        deviceId,
        { pondId: otherPondId },
        farmerId,
        Role.FARMER,
      );

      expect(result.pondId).toBe(otherPondId);
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(device);
    });

    it('nên từ chối farmer chuyển thiết bị sang ao của farmer khác', async () => {
      const device = {
        deviceId,
        pondId,
        macAddress: 'AA:BB:CC:DD:EE:FF',
        pond: { pondId, userId: farmerId },
      };

      mockDeviceRepo.findOne.mockResolvedValueOnce(device);
      mockPondRepo.findOne.mockResolvedValue({
        pondId: otherPondId,
        userId: otherFarmerId,
      });

      await expect(
        service.updateDevice(
          deviceId,
          { pondId: otherPondId },
          farmerId,
          Role.FARMER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockDeviceRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('deleteDevice', () => {
    it('nên xóa thiết bị khi người dùng có quyền', async () => {
      const device = {
        deviceId,
        pondId,
        pond: { pondId, userId: farmerId },
      };

      mockDeviceRepo.findOne.mockResolvedValue(device);

      const result = await service.deleteDevice(
        deviceId,
        farmerId,
        Role.FARMER,
      );

      expect(result).toEqual({ message: 'Xóa thiết bị thành công!' });
      expect(mockDeviceRepo.remove).toHaveBeenCalledWith(device);
    });

    it('nên từ chối xóa thiết bị của farmer khác', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId,
        pondId,
        pond: { pondId, userId: otherFarmerId },
      });

      await expect(
        service.deleteDevice(deviceId, farmerId, Role.FARMER),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockDeviceRepo.remove).not.toHaveBeenCalled();
    });
  });
});
