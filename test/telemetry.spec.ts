import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js';
import { DataSource } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { User } from '../src/modules/users/entities/user.entity.js';
import { Pond } from '../src/modules/ponds/entities/pond.entity.js';
import { Device } from '../src/modules/devices/entities/device.entity.js';
import { Role } from '../src/common/enums/role.enum.js';
import { PondStatus } from '../src/common/enums/pond-status.enum.js';
import { DeviceStatus } from '../src/common/enums/device-status.enum.js';

describe('Telemetry & TimescaleDB Integration Test', () => {
  let moduleRef: TestingModule;
  let telemetryService: TelemetryService;
  let dataSource: DataSource;
  let testDeviceId: string;
  let testUserId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    telemetryService = moduleRef.get(TelemetryService);
    dataSource = moduleRef.get(DataSource);

    // Tạo thiết bị mẫu hợp lệ để thỏa mãn ràng buộc khóa ngoại Device -> TelemetryData
    const userRepo = dataSource.getRepository(User);
    const pondRepo = dataSource.getRepository(Pond);
    const deviceRepo = dataSource.getRepository(Device);

    const user = await userRepo.save(
      userRepo.create({
        fullName: 'Test Telemetry User',
        phoneNumber: `091${Date.now().toString().slice(-7)}`,
        passwordHash: 'hashed_password',
        role: Role.FARMER,
      }),
    );
    testUserId = user.userId;

    const pond = await pondRepo.save(
      pondRepo.create({
        userId: user.userId,
        pondName: 'Ao Test Telemetry',
        areaM2: 1000,
        depthM: 1.5,
        shrimpDensity: 100,
        status: PondStatus.ACTIVE,
      }),
    );

    const device = await deviceRepo.save(
      deviceRepo.create({
        pondId: pond.pondId,
        deviceName: 'Device Test Telemetry',
        macAddress: `00:11:22:${Math.floor(Math.random() * 89 + 10)}:${Math.floor(Math.random() * 89 + 10)}:${Math.floor(Math.random() * 89 + 10)}`,
        status: DeviceStatus.ONLINE,
      }),
    );
    testDeviceId = device.deviceId;
  });

  afterAll(async () => {
    if (dataSource && testUserId) {
      await dataSource.getRepository(User).delete(testUserId);
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('phải kết nối thành công và xác nhận extension timescaledb đã cài đặt', async () => {
    const ext = await dataSource.query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';",
    );
    expect(ext).toBeDefined();
    expect(ext.length).toBeGreaterThan(0);
    expect(ext[0].extname).toBe('timescaledb');
  });

  it('phải xác nhận bảng telemetry_data là Hypertable', async () => {
    const hypertable = await dataSource.query(
      "SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name = 'telemetry_data';",
    );
    expect(hypertable).toBeDefined();
    expect(hypertable.length).toBeGreaterThan(0);
    expect(hypertable[0].hypertable_name).toBe('telemetry_data');
  });

  it('phải ghi và truy vấn dữ liệu cảm biến chuỗi thời gian thành công', async () => {
    const newRecord = await telemetryService.recordTelemetry({
      deviceId: testDeviceId,
      temperature: 29.2,
      ph: 7.9,
      dissolvedOxygen: 6.1,
      salinity: 16.5,
      turbidity: 18.0,
      waterLevel: 1.3,
      isBuffered: false,
    });

    expect(newRecord).toBeDefined();
    expect(newRecord.id).toBeDefined();
    expect(newRecord.temperature).toBe(29.2);

    const latest = await telemetryService.getLatestByDeviceId(testDeviceId);
    expect(latest).toBeDefined();
    expect(latest?.deviceId).toBe(testDeviceId);
    expect(latest?.temperature).toBe(29.2);
    expect(latest?.ph).toBe(7.9);
    expect(latest?.dissolvedOxygen).toBe(6.1);
  });
});
