import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js';
import { DataSource } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Telemetry & TimescaleDB Integration Test', () => {
  let moduleRef: TestingModule;
  let telemetryService: TelemetryService;
  let dataSource: DataSource;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    telemetryService = moduleRef.get(TelemetryService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
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
    const testDeviceId = 'a0000000-0000-0000-0000-000000000001';
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
