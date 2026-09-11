import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TelemetryData } from './entities/telemetry-data.entity.js';

@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    @InjectRepository(TelemetryData)
    private readonly telemetryRepo: Repository<TelemetryData>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureTimescaleDbConfig();
  }

  /**
   * Đảm bảo extension TimescaleDB và Hypertable telemetry_data đã được kích hoạt.
   */
  async ensureTimescaleDbConfig(): Promise<void> {
    try {
      // 1. Kiểm tra extension timescaledb
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;');
      this.logger.log('✅ [TimescaleDB] Extension timescaledb sẵn sàng.');

      // 2. Đảm bảo bảng telemetry_data được cấu hình thành Hypertable
      const isHypertableResult = await this.dataSource.query(`
        SELECT count(*) as count 
        FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'telemetry_data';
      `);

      const isHypertable = parseInt(isHypertableResult[0]?.count, 10) > 0;

      if (!isHypertable) {
        await this.dataSource.query(`
          SELECT create_hypertable(
            'telemetry_data', 
            'recorded_at', 
            chunk_time_interval => INTERVAL '7 days', 
            if_not_exists => TRUE
          );
        `);
        this.logger.log('✅ [TimescaleDB] Đã khởi tạo Hypertable cho bảng telemetry_data (chu kỳ 7 ngày).');
      } else {
        this.logger.log('✅ [TimescaleDB] Bảng telemetry_data đã là Hypertable.');
      }
    } catch (error) {
      this.logger.error('❌ [TimescaleDB] Lỗi khởi tạo cấu hình TimescaleDB:', error);
    }
  }

  /**
   * Lưu bản ghi dữ liệu cảm biến
   */
  async recordTelemetry(data: Partial<TelemetryData>): Promise<TelemetryData> {
    const record = this.telemetryRepo.create(data);
    return await this.telemetryRepo.save(record);
  }

  /**
   * Lấy bản ghi mới nhất của một thiết bị
   */
  async getLatestByDeviceId(deviceId: string): Promise<TelemetryData | null> {
    return await this.telemetryRepo.findOne({
      where: { deviceId },
      order: { recordedAt: 'DESC' },
    });
  }
}
