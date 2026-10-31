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
    mockAlertsService = {
      createThresholdAlert: vi.fn().mockResolvedValue({ alertId: 'alert-1' }),
      createAlert: vi.fn().mockResolvedValue({ alertId: 'offline-alert' }),
    };
    mockRedisService = {
      setIfAbsent: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(1),
      publish: vi.fn().mockResolvedValue(1),
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
        relations: { pond: true },
        select: {
          deviceId: true,
          pondId: true,
          status: true,
          lastActiveAt: true,
          pond: {
            pondId: true,
            userId: true,
          },
        },
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
        pondId: 'pond-1',
        pond: { pondId: 'pond-1', userId: 'user-1' },
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
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        'telemetry:new',
        JSON.stringify({
          pondId: existingDevice.pondId,
          userId: existingDevice.pond.userId,
          data: result,
        }),
      );
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

    it('delegates each newly persisted HIGH or LOW threshold alert to the canonical alert publisher', async () => {
      const device = {
        deviceId: 'device-1',
        pondId: 'pond-1',
        pond: { userId: 'owner-1' },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      ]);
      mockAlertsService.createThresholdAlert
        .mockResolvedValueOnce({ alertId: 'low-alert' })
        .mockResolvedValueOnce({ alertId: 'high-alert' });

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 19 });
      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 31 });

      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
      expect(mockRedisService.publish.mock.calls.filter(
        ([channel]: [string]) => channel === 'alert:triggered',
      )).toHaveLength(0);
    });

    it('does not delegate a threshold alert when cooldown suppresses a repeated breach', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId: 'device-1',
        pondId: 'pond-1',
        pond: { userId: 'owner-1' },
      });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      ]);
      mockRedisService.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 31 });
      await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 31 });

      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(1);
    });

    it('keeps persisted telemetry valid when canonical alert publishing is handled downstream', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({
        deviceId: 'device-1',
        pondId: 'pond-1',
        pond: { userId: 'owner-1' },
      });
      mockThresholdConfigRepo.find.mockResolvedValue([
        { pondId: 'pond-1', metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      ]);
      const result = await service.processTelemetryPayload({ deviceId: 'device-1', temperature: 31 });

      expect(result).not.toBeNull();
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(1);
      expect(mockRedisService.del).not.toHaveBeenCalled();
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

  describe('Phase 8 / Section 12 — 30 Alert Engine Scenarios', () => {
    const pondId = 'pond-uuid-1';
    const deviceId = 'device-uuid-1';
    const standardDevice = { deviceId, pondId, status: DeviceStatus.ONLINE };

    // Standard configs for 5 metrics
    const baseConfigs = [
      { pondId, metricName: 'temperature', minValue: 20, maxValue: 30, isActive: true },
      { pondId, metricName: 'pH', minValue: 7.0, maxValue: 8.5, isActive: true },
      { pondId, metricName: 'dissolvedOxygen', minValue: 4.0, maxValue: 8.0, isActive: true },
      { pondId, metricName: 'salinity', minValue: 10, maxValue: 25, isActive: true },
      { pondId, metricName: 'turbidity', minValue: 10, maxValue: 50, isActive: true },
    ];

    beforeEach(() => {
      mockDeviceRepo.findOne.mockResolvedValue({ ...standardDevice });
      mockThresholdConfigRepo.find.mockResolvedValue([...baseConfigs]);
      mockRedisService.setIfAbsent.mockResolvedValue(true);
      mockRedisService.del.mockResolvedValue(1);
      mockAlertsService.createThresholdAlert.mockResolvedValue({ alertId: 'alert-1' });
    });

    it('Scenario 01: Temperature BELOW_MIN triggers WARNING LOW alert', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:temperature:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'temperature',
          triggeredValue: 18,
          direction: 'LOW',
        }),
      );
    });

    it('Scenario 02: Temperature ABOVE_MAX triggers WARNING HIGH alert', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 32 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:temperature:HIGH`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'temperature',
          triggeredValue: 32,
          direction: 'HIGH',
        }),
      );
    });

    it('Scenario 03: Temperature NORMAL within range triggers no alert', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 25 });
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
      expect(mockRedisService.setIfAbsent).not.toHaveBeenCalled();
    });

    it('Scenario 04: PH BELOW_MIN triggers WARNING LOW alert', async () => {
      await service.processTelemetryPayload({ deviceId, ph: 6.5 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:ph:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'pH',
          triggeredValue: 6.5,
          direction: 'LOW',
        }),
      );
    });

    it('Scenario 05: PH ABOVE_MAX triggers WARNING HIGH alert', async () => {
      await service.processTelemetryPayload({ deviceId, ph: 9.0 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:ph:HIGH`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'pH',
          triggeredValue: 9.0,
          direction: 'HIGH',
        }),
      );
    });

    it('Scenario 06: Dissolved Oxygen BELOW_MIN triggers WARNING LOW alert', async () => {
      await service.processTelemetryPayload({ deviceId, dissolvedOxygen: 3.5 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:dissolvedoxygen:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'dissolvedOxygen',
          triggeredValue: 3.5,
          direction: 'LOW',
        }),
      );
    });

    it('Scenario 07: Dissolved Oxygen ABOVE_MAX triggers WARNING HIGH alert', async () => {
      await service.processTelemetryPayload({ deviceId, dissolvedOxygen: 9.2 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:dissolvedoxygen:HIGH`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'dissolvedOxygen',
          triggeredValue: 9.2,
          direction: 'HIGH',
        }),
      );
    });

    it('Scenario 08: Salinity BELOW_MIN triggers WARNING LOW alert', async () => {
      await service.processTelemetryPayload({ deviceId, salinity: 8 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:salinity:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'salinity',
          triggeredValue: 8,
          direction: 'LOW',
        }),
      );
    });

    it('Scenario 09: Salinity ABOVE_MAX triggers WARNING HIGH alert', async () => {
      await service.processTelemetryPayload({ deviceId, salinity: 28 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:salinity:HIGH`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'salinity',
          triggeredValue: 28,
          direction: 'HIGH',
        }),
      );
    });

    it('Scenario 10: Turbidity BELOW_MIN triggers WARNING LOW alert', async () => {
      await service.processTelemetryPayload({ deviceId, turbidity: 5 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:turbidity:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'turbidity',
          triggeredValue: 5,
          direction: 'LOW',
        }),
      );
    });

    it('Scenario 11: Turbidity ABOVE_MAX triggers WARNING HIGH alert', async () => {
      await service.processTelemetryPayload({ deviceId, turbidity: 55 });
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:turbidity:HIGH`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          pondId,
          deviceId,
          metricName: 'turbidity',
          triggeredValue: 55,
          direction: 'HIGH',
        }),
      );
    });

    it('Scenario 12: Value exactly equals minValue is normal and triggers no alert', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 20 });
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
      expect(mockRedisService.setIfAbsent).not.toHaveBeenCalled();
    });

    it('Scenario 13: Value exactly equals maxValue is normal and triggers no alert', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 30 });
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
      expect(mockRedisService.setIfAbsent).not.toHaveBeenCalled();
    });

    it('Scenario 14: Missing metric (null or undefined) is skipped without alert', async () => {
      await service.processTelemetryPayload({
        deviceId,
        temperature: null as any,
        ph: undefined,
      });
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it('Scenario 15: Metric value = 0 is treated as valid number and triggers BELOW_MIN alert', async () => {
      await service.processTelemetryPayload({ deviceId, turbidity: 0 });
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          metricName: 'turbidity',
          triggeredValue: 0,
          direction: 'LOW',
        }),
      );
    });

    it('Scenario 16: Pond without active threshold config triggers no alert', async () => {
      mockThresholdConfigRepo.find.mockResolvedValue([]);
      await service.processTelemetryPayload({ deviceId, temperature: 15 });
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it('Scenario 17: Device without assigned pond skips threshold evaluation entirely', async () => {
      mockDeviceRepo.findOne.mockResolvedValue({ deviceId: 'unassigned-dev', pondId: null });
      await service.processTelemetryPayload({ deviceId: 'unassigned-dev', temperature: 15 });
      expect(mockThresholdConfigRepo.find).not.toHaveBeenCalled();
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
    });

    it('Scenario 18: Multiple metrics violating simultaneously trigger separate alerts', async () => {
      await service.processTelemetryPayload({
        deviceId,
        temperature: 35,
        ph: 6.0,
      });
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({ metricName: 'temperature', direction: 'HIGH', triggeredValue: 35 }),
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({ metricName: 'pH', direction: 'LOW', triggeredValue: 6.0 }),
      );
    });

    it('Scenario 19: Cooldown prevents duplicate alert within 15 minutes', async () => {
      mockRedisService.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(1);
    });

    it('Scenario 20: Cooldown expires allowing subsequent violation to trigger new alert', async () => {
      mockRedisService.setIfAbsent
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
    });

    it('Scenario 21: Different devices maintain isolated cooldowns and alerts', async () => {
      const dev1 = { deviceId: 'dev-1', pondId };
      const dev2 = { deviceId: 'dev-2', pondId };
      mockDeviceRepo.findOne
        .mockResolvedValueOnce(dev1)
        .mockResolvedValueOnce(dev2);

      await service.processTelemetryPayload({ deviceId: 'dev-1', temperature: 18 });
      await service.processTelemetryPayload({ deviceId: 'dev-2', temperature: 18 });

      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:dev-1:temperature:LOW`,
        '1',
        900,
      );
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:dev-2:temperature:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
    });

    it('Scenario 22: Different metrics on same device have isolated cooldowns', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      await service.processTelemetryPayload({ deviceId, ph: 6.0 });

      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:temperature:LOW`,
        '1',
        900,
      );
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:ph:LOW`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
    });

    it('Scenario 23: Different violation directions (LOW vs HIGH) maintain distinct cooldown keys', async () => {
      await service.processTelemetryPayload({ deviceId, temperature: 18 });
      await service.processTelemetryPayload({ deviceId, temperature: 35 });

      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:temperature:LOW`,
        '1',
        900,
      );
      expect(mockRedisService.setIfAbsent).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:temperature:HIGH`,
        '1',
        900,
      );
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(2);
    });

    it('Scenario 24: Concurrent telemetry messages do not duplicate alerts due to atomic setIfAbsent', async () => {
      mockRedisService.setIfAbsent
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const [res1, res2] = await Promise.all([
        service.processTelemetryPayload({ deviceId, temperature: 18 }),
        service.processTelemetryPayload({ deviceId, temperature: 18 }),
      ]);

      expect(res1).not.toBeNull();
      expect(res2).not.toBeNull();
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(1);
    });

    it('Scenario 25: Redis failure does not crash telemetry persistence', async () => {
      mockRedisService.setIfAbsent.mockRejectedValueOnce(new Error('Redis connection refused'));

      const result = await service.processTelemetryPayload({ deviceId, temperature: 18 });

      expect(result).not.toBeNull();
      expect(mockTelemetryRepo.save).toHaveBeenCalled();
    });

    it('Scenario 26: Alert insertion failure rolls back Redis cooldown reservation', async () => {
      mockAlertsService.createThresholdAlert.mockRejectedValueOnce(new Error('DB write failed'));

      const result = await service.processTelemetryPayload({ deviceId, temperature: 18 });

      expect(result).not.toBeNull();
      expect(mockRedisService.del).toHaveBeenCalledWith(
        `alert:cooldown:${pondId}:${deviceId}:temperature:LOW`,
      );
    });

    it('Scenario 27: Duplicate MQTT delivery within cooldown window is suppressed', async () => {
      mockRedisService.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const payload = { deviceId, temperature: 35 };
      await service.processTelemetryPayload(payload);
      await service.processTelemetryPayload(payload);

      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledTimes(1);
    });

    it('Scenario 28: Buffered telemetry (isBuffered: true) saves data but skips alert generation', async () => {
      const result = await service.processTelemetryPayload({
        deviceId,
        temperature: 45,
        isBuffered: true,
      });

      expect(result).not.toBeNull();
      expect(mockTelemetryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isBuffered: true, temperature: 45 }),
      );
      expect(mockAlertsService.createThresholdAlert).not.toHaveBeenCalled();
      expect(mockRedisService.setIfAbsent).not.toHaveBeenCalled();
    });

    it('Scenario 29: Telemetry persistence remains fully functional regardless of alert outcome', async () => {
      mockThresholdConfigRepo.find.mockRejectedValueOnce(new Error('Threshold query error'));

      const result = await service.processTelemetryPayload({ deviceId, temperature: 28 });

      expect(result).not.toBeNull();
      expect(mockTelemetryRepo.save).toHaveBeenCalled();
      expect(mockDeviceRepo.update).toHaveBeenCalledWith(
        deviceId,
        expect.objectContaining({ status: DeviceStatus.ONLINE }),
      );
    });

    it('Scenario 30: Existing realtime event behavior (ONLINE status & offline check) remains functional', async () => {
      const offlineDev = { deviceId: 'stale-dev', pondId, status: DeviceStatus.ONLINE };
      mockDeviceRepo.find.mockResolvedValue([offlineDev]);
      mockDeviceRepo.findOne.mockResolvedValue(offlineDev);
      mockAlertRepo.findOne.mockResolvedValue(null);

      const count = await service.checkAndMarkOfflineDevices(15);

      expect(count).toBe(1);
      expect(offlineDev.status).toBe(DeviceStatus.OFFLINE);
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(offlineDev);
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
      expect(mockAlertsService.createAlert).toHaveBeenCalledWith(expect.objectContaining({
        pondId: 'test-pond-id',
        deviceId: 'test-device-id',
        metricName: 'device_status',
      }));
    });

    it('creates an offline-device alert through the canonical alert publisher', async () => {
      const device = {
        deviceId: 'offline-device',
        pondId: 'pond-1',
        pond: { userId: 'owner-1' },
        status: DeviceStatus.ONLINE,
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockAlertRepo.findOne.mockResolvedValue(null);

      await service.updateDeviceStatus(device.deviceId, DeviceStatus.OFFLINE);

      expect(mockAlertsService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({ pondId: 'pond-1', deviceId: 'offline-device' }),
      );
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

  describe('getThresholdConfigsForPond & Escalation', () => {
    it('uses cached threshold configs from Redis if available', async () => {
      mockRedisService.get = vi.fn().mockResolvedValue(JSON.stringify([{ metricName: 'pH', minValue: 7, maxValue: 8, isActive: true }]));
      const result = await service.getThresholdConfigsForPond('pond-1');
      expect(result).toHaveLength(1);
      expect(mockThresholdConfigRepo.find).not.toHaveBeenCalled();
    });

    it('queries DB and caches in Redis when cache misses', async () => {
      mockRedisService.get = vi.fn().mockResolvedValue(null);
      mockRedisService.set = vi.fn().mockResolvedValue('OK');
      mockThresholdConfigRepo.find.mockResolvedValue([{ metricName: 'DO', minValue: 4, maxValue: 8, isActive: true }]);

      const result = await service.getThresholdConfigsForPond('pond-1');
      expect(result).toHaveLength(1);
      expect(mockThresholdConfigRepo.find).toHaveBeenCalledWith({ where: { pondId: 'pond-1', isActive: true } });
      expect(mockRedisService.set).toHaveBeenCalledWith('cache:thresholds:pond-1', expect.any(String), 900);
    });

    it('determines CRITICAL alert level for extreme breaches or DO < 3.0', () => {
      expect(service.determineAlertLevel('dissolvedoxygen', 2.8, 4.0, 8.0, 'LOW')).toBe('CRITICAL');
      expect(service.determineAlertLevel('temperature', 38, 20, 30, 'HIGH')).toBe('CRITICAL');
      expect(service.determineAlertLevel('temperature', 31, 20, 30, 'HIGH')).toBe('WARNING');
    });

    it('bypasses cooldown when breach escalates to CRITICAL', async () => {
      const device = {
        deviceId: 'device-1',
        pondId: 'pond-1',
        pond: { userId: 'user-1' },
      };
      mockDeviceRepo.findOne.mockResolvedValue(device);
      mockThresholdConfigRepo.find.mockResolvedValue([
        { metricName: 'DO', minValue: 4.0, maxValue: 8.0, isActive: true },
      ]);
      mockRedisService.get = vi.fn().mockImplementation((key) => {
        if (key.endsWith(':level')) return Promise.resolve('WARNING');
        return Promise.resolve(null);
      });
      mockRedisService.set = vi.fn().mockResolvedValue('OK');
      mockRedisService.setIfAbsent.mockResolvedValue(false); // Cooldown already exists

      // Gửi DO = 2.0 (nguy cấp, < 3.0 -> CRITICAL)
      await service.processTelemetryPayload({ deviceId: 'device-1', dissolvedOxygen: 2.0 });

      // Cảnh báo CRITICAL vẫn được tạo do escalation
      expect(mockAlertsService.createThresholdAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertLevel: 'CRITICAL',
          triggeredValue: 2.0,
        }),
      );
    });
  });
});
