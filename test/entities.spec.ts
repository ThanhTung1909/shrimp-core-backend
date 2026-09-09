import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../src/modules/users/entities/user.entity.js';
import { Pond } from '../src/modules/ponds/entities/pond.entity.js';
import { Device } from '../src/modules/devices/entities/device.entity.js';
import { ThresholdConfig } from '../src/modules/ponds/entities/threshold-config.entity.js';
import { TelemetryData } from '../src/modules/telemetry/entities/telemetry-data.entity.js';
import { Role } from '../src/common/enums/role.enum.js';
import { PondStatus } from '../src/common/enums/pond-status.enum.js';
import { DeviceStatus } from '../src/common/enums/device-status.enum.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('TypeORM Entities & Relations Test (DB-02)', () => {
  let moduleRef: TestingModule;
  let userRepo: Repository<User>;
  let pondRepo: Repository<Pond>;
  let deviceRepo: Repository<Device>;
  let thresholdRepo: Repository<ThresholdConfig>;
  let telemetryRepo: Repository<TelemetryData>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    userRepo = moduleRef.get(getRepositoryToken(User));
    pondRepo = moduleRef.get(getRepositoryToken(Pond));
    deviceRepo = moduleRef.get(getRepositoryToken(Device));
    thresholdRepo = moduleRef.get(getRepositoryToken(ThresholdConfig));
    telemetryRepo = moduleRef.get(getRepositoryToken(TelemetryData));
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('phải tạo và liên kết đầy đủ sơ đồ thực thể: User -> Pond -> Device, ThresholdConfig -> TelemetryData', async () => {
    // 1. Tạo User
    const testPhone = `099${Date.now().toString().slice(-7)}`;
    const user = userRepo.create({
      fullName: 'Nguyễn Văn Nông Dân',
      phoneNumber: testPhone,
      passwordHash: 'hashed_password_secure',
      role: Role.FARMER,
      isActive: true,
    });
    const savedUser = await userRepo.save(user);
    expect(savedUser.userId).toBeDefined();

    // 2. Tạo Pond gán cho User
    const pond = pondRepo.create({
      userId: savedUser.userId,
      pondName: 'Ao Nuôi Thẻ Chân Trắng Số 1',
      areaM2: 2500,
      depthM: 1.6,
      shrimpDensity: 150,
      status: PondStatus.ACTIVE,
    });
    const savedPond = await pondRepo.save(pond);
    expect(savedPond.pondId).toBeDefined();
    expect(savedPond.userId).toBe(savedUser.userId);

    // 3. Tạo Device gán cho Pond
    const testMac = `00:1A:2B:${Math.floor(Math.random() * 89 + 10)}:${Math.floor(Math.random() * 89 + 10)}:${Math.floor(Math.random() * 89 + 10)}`;
    const device = deviceRepo.create({
      pondId: savedPond.pondId,
      deviceName: 'Trạm Quan Trắc Trung Tâm 01',
      macAddress: testMac,
      firmwareVersion: 'v1.2.0',
      status: DeviceStatus.ONLINE,
    });
    const savedDevice = await deviceRepo.save(device);
    expect(savedDevice.deviceId).toBeDefined();
    expect(savedDevice.pondId).toBe(savedPond.pondId);

    // 4. Tạo ThresholdConfig gán cho Pond
    const threshold = thresholdRepo.create({
      pondId: savedPond.pondId,
      metricName: 'pH',
      minValue: 7.5,
      maxValue: 8.5,
      isActive: true,
    });
    const savedThreshold = await thresholdRepo.save(threshold);
    expect(savedThreshold.configId).toBeDefined();

    // 5. Tạo TelemetryData gán cho Device
    const telemetry = telemetryRepo.create({
      deviceId: savedDevice.deviceId,
      temperature: 28.5,
      ph: 7.9,
      salinity: 15.0,
      dissolvedOxygen: 6.2,
      turbidity: 20.0,
      waterLevel: 1.4,
      isBuffered: false,
    });
    const savedTelemetry = await telemetryRepo.save(telemetry);
    expect(savedTelemetry.id).toBeDefined();

    // 6. Truy vấn quan hệ lồng nhau (Relation graph) từ User
    const foundUser = await userRepo.findOne({
      where: { userId: savedUser.userId },
      relations: {
        ponds: {
          devices: {
            telemetries: true,
          },
          thresholdConfigs: true,
        },
      },
    });

    expect(foundUser).toBeDefined();
    expect(foundUser?.ponds.length).toBe(1);
    expect(foundUser?.ponds[0].pondName).toBe('Ao Nuôi Thẻ Chân Trắng Số 1');
    expect(foundUser?.ponds[0].devices.length).toBe(1);
    expect(foundUser?.ponds[0].devices[0].deviceName).toBe('Trạm Quan Trắc Trung Tâm 01');
    expect(foundUser?.ponds[0].thresholdConfigs.length).toBe(1);
    expect(foundUser?.ponds[0].thresholdConfigs[0].metricName).toBe('pH');

    // 7. Kiểm tra Cascade Delete: Xóa User thì toàn bộ Pond, Device, Threshold, Telemetry liên quan tự xóa
    await userRepo.delete(savedUser.userId);

    const checkPond = await pondRepo.findOne({ where: { pondId: savedPond.pondId } });
    expect(checkPond).toBeNull();

    const checkDevice = await deviceRepo.findOne({ where: { deviceId: savedDevice.deviceId } });
    expect(checkDevice).toBeNull();

    const checkThreshold = await thresholdRepo.findOne({ where: { configId: savedThreshold.configId } });
    expect(checkThreshold).toBeNull();
  });
});
