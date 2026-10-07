import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryService } from './telemetry.service.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { CreateTelemetryDto } from './dto/create-telemetry.dto.js';

describe('TelemetryService', () => {
  let service: TelemetryService;
  let mockTelemetryRepo: any;
  let mockDeviceRepo: any;
  let mockAlertRepo: any;
  let mockThresholdConfigRepo: any;
  let mockDataSource: any;
  let mockAlertsService: any;
  let mockRedisService: any;

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

    mockThresholdConfigRepo = { find: vi.fn().mockResolvedValue([]) };
    mockAlertsService = { createThresholdAlert: vi.fn().mockResolvedValue({ alertId: 'alert-1' }) };
    mockRedisService = {
      setIfAbsent: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(1),
    };

    service = new TelemetryService(
      mockTelemetryRepo,
      mockDeviceRepo,
      mockAlertRepo,
      mockThresholdConfigRepo,
      mockDataSource,
      mockAlertsService,
      mockRedisService,
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
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
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
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it('lưu telemetry cho thiết bị không có ao và không đánh giá ngưỡng', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: null });

      const result = await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 30 });

      expect(result).not.toBeNull();
      expect(mockThresholdConfigRepo.find).not.toHaveBeenCalled();
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it.each([
      ['in-range', 25, 20, 30],
      ['exactly min', 20, 20, 30],
      ['exactly max', 30, 20, 30],
    ])('does not create an alert for %s value', async (_description, value, minValue, maxValue) => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue, maxValue, isActive: true },
      ]);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: value });

      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
      expect(mockRedisService.setIfAbsent).not.toHaveBeenCalled();
    });

    it.each([
      ['below', 19, 'LOW'],
      ['above', 31, 'HIGH'],
    ])('creates a WARNING threshold alert when temperature is %s range', async (_description, value, direction) => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      ]);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: value });

      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:pond-1:device-1:temperature:${direction}`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(expect.objectContaining({
        metricName: 'temperature', triggeredValue: value, direction,
      }));
    });

    it('ignores null and undefined telemetry metrics', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
        { pondId: 'pond-1', metricName: 'pH', minValue: 7, maxValue: 8, isActive: true },
      ]);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: null as any, ph: undefined });

      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it('ignores inactive and unsupported waterLevel threshold configurations', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: false },
        { pondId: 'pond-1', metricName: 'waterLevel', minValue: 1, maxValue: 2, isActive: true },
      ]);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 35, waterLevel: 3 });

      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it('supports existing pH, DO and temp stored metric names', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'pH', minValue: 7, maxValue: 8, isActive: true },
        { pondId: 'pond-1', metricName: 'DO', minValue: 4, maxValue: 8, isActive: true },
        { pondId: 'pond-1', metricName: 'temp', minValue: 20, maxValue: 30, isActive: true },
      ]);

      await service.processTelemetryPayload({ deviceId: 'device-1', ph: 6, dissolvedOxygen: 3, temperature: 31 });

      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(3);
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'pH' }));
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'DO' }));
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(expect.objectContaining({ metricName: 'temp' }));
    });

    it('suppresses repeated violations within the cooldown, but allows another after it expires', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      ]);
      mockRedisService.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });
      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });
      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });

      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
    });

    it('uses distinct cooldown identities for direction, device, and pond', async () => {
      const config = { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true };
      mockDeviceRepo.findOne.mockResolvedValueOnce({ deviceId: 'device-1', pondId: 'pond-1' })
        .mockResolvedValueOnce({ deviceId: 'device-1', pondId: 'pond-2' })
        .mockResolvedValueOnce({ deviceId: 'device-2', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValueOnce([config])
        .mockResolvedValueOnce([{ ...config, pondId: 'pond-2' }])
        .mockResolvedValueOnce([config]);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });
      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 31 });
      await service.processTelemetryPayload({ deviceId: 'device-2', temperature: 19 });

      expect(mockRedisService.setIfAbsent.mock.calls.map((call: any[]) => call[0])).toEqual([
        'alert:cooldown:pond-1:device-1:temperature:LOW',
        'alert:cooldown:pond-2:device-1:temperature:HIGH',
        'alert:cooldown:pond-1:device-2:temperature:LOW',
      ]);
    });

    it('keeps saved telemetry successful when alert engine fails', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockRejectedValue(new Error('Redis unavailable'));

      const result = await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });

      expect(result).not.toBeNull();
      expect(mockTelemetryRepo.save).toHaveBeenCalled();
    });

    it('removes the cooldown when alert persistence fails so a retry is not suppressed', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'device-1', pondId: 'pond-1' });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      ]);
      mockAlertsService.createThresholdAlert.mockRejectedValueOnce(new Error('database unavailable'));

      const result = await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });

      expect(result).not.toBeNull();
      expect(mockRedisService.del).toHaveBeenCalledWith('alert:cooldown:pond-1:device-1:temperature:LOW');
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
