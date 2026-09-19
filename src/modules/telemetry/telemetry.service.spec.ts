import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryService } from './telemetry.service.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { CreateTelemetryDto } from './dto/create-telemetry.dto.js';

describe('TelemetryService', () => {
  let service: TelemetryService;
  let mockTelemetryRepo: any;
  let mockDeviceRepo: any;
  let mockAlertRepo: any;
  let mockDataSource: any;

  beforeEach(() => {
    mockTelemetryRepo = {
      create: vi.fn((data) => data),
      save: vi.fn((data) => Promise.resolve({ id: '1', ...data })),
      findOne: vi.fn(),
      findAndCount: vi.fn(),
    };

    mockDeviceRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      save: vi.fn((data) => Promise.resolve(data)),
    };

    mockAlertRepo = {
      findOne: vi.fn(),
      create: vi.fn((data) => data),
      save: vi.fn((data) => Promise.resolve({ id: '1', ...data })),
    };

    mockDataSource = {
      query: vi.fn().mockResolvedValue([{ count: '1' }]),
    };

    service = new TelemetryService(
      mockTelemetryRepo,
      mockDeviceRepo,
      mockAlertRepo,
      mockDataSource,
    );
  });

  describe('processTelemetryPayload', () => {
    it('nên từ chối lưu trữ và trả về null khi deviceId chưa đăng ký trong CSDL', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);

      const dto: CreateTelemetryDto = {
        deviceId: '00000000-0000-0000-0000-000000000000',
        temperature: 28.5,
        ph: 7.8,
      };

      const result = await service.processTelemetryPayload(dto);

      expect(result).toBeNull();
      expect(mockDeviceRepo.findOne).toHaveBeenCalledWith({
        where: { deviceId: dto.deviceId },
      });
      expect(mockTelemetryRepo.save).not.toHaveBeenCalled();
      expect(mockDeviceRepo.update).not.toHaveBeenCalled();
    });

    it('nên lưu trữ dữ liệu vào TimescaleDB và cập nhật thiết bị sang ONLINE khi deviceId hợp lệ', async () => {
      const existingDevice = {
        deviceId: '11111111-1111-1111-1111-111111111111',
        deviceName: 'Cảm biến Ao 1',
        status: DeviceStatus.OFFLINE,
      };

      mockDeviceRepo.findOne.mockResolvedValue(existingDevice);

      const dto: CreateTelemetryDto = {
        deviceId: existingDevice.deviceId,
        temperature: 29.2,
        ph: 8.1,
        dissolvedOxygen: 6.5,
        salinity: 15.0,
      };

      const result = await service.processTelemetryPayload(dto);

      expect(result).not.toBeNull();
      expect(mockTelemetryRepo.save).toHaveBeenCalled();
      expect(mockDeviceRepo.update).toHaveBeenCalledWith(
        existingDevice.deviceId,
        expect.objectContaining({
          status: DeviceStatus.ONLINE,
        }),
      );
    });
  });

  describe('getLatestByDeviceId', () => {
    it('nên trả về bản ghi dữ liệu cảm biến mới nhất', async () => {
      const mockRecord = {
        id: '10',
        deviceId: '11111111-1111-1111-1111-111111111111',
        temperature: 29.0,
        recordedAt: new Date(),
      };
      mockTelemetryRepo.findOne.mockResolvedValue(mockRecord);

      const result = await service.getLatestByDeviceId(mockRecord.deviceId);

      expect(result).toEqual(mockRecord);
      expect(mockTelemetryRepo.findOne).toHaveBeenCalledWith({
        where: { deviceId: mockRecord.deviceId },
        order: { recordedAt: 'DESC' },
      });
    });
  });

  describe('updateDeviceStatus', () => {
    it('nên cập nhật thiết bị sang OFFLINE và tự động chèn bản ghi Alert', async () => {
      const deviceId = 'test-device-id';
      const mockDevice = { deviceId, pondId: 'test-pond-id', status: DeviceStatus.ONLINE, lastActiveAt: new Date() };
      mockDeviceRepo.findOne.mockResolvedValue(mockDevice);
      mockAlertRepo.findOne.mockResolvedValue(null);

      await service.updateDeviceStatus(deviceId, DeviceStatus.OFFLINE);

      expect(mockDevice.status).toBe(DeviceStatus.OFFLINE);
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(mockDevice);
      expect(mockAlertRepo.findOne).toHaveBeenCalled();
      expect(mockAlertRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        pondId: 'test-pond-id',
        deviceId: 'test-device-id',
        metricName: 'device_status',
      }));
      expect(mockAlertRepo.save).toHaveBeenCalled();
    });
  });

  describe('checkAndMarkOfflineDevices', () => {
    it('nên quét thiết bị không có tín hiệu quá thời gian và chuyển sang OFFLINE', async () => {
      const mockDevice = { deviceId: 'test-device-id', pondId: 'test-pond-id', status: DeviceStatus.ONLINE };
      mockDeviceRepo.find.mockResolvedValue([mockDevice]);
      mockDeviceRepo.findOne.mockResolvedValue(mockDevice);
      mockAlertRepo.findOne.mockResolvedValue(null);

      const count = await service.checkAndMarkOfflineDevices(20);

      expect(count).toBe(1);
      expect(mockDeviceRepo.find).toHaveBeenCalled();
      expect(mockDevice.status).toBe(DeviceStatus.OFFLINE);
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(mockDevice);
    });
  });
});
