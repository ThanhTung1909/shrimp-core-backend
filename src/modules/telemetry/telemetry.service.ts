import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { TelemetryData } from './entities/telemetry-data.entity.js';
import { Device } from '../devices/entities/device.entity.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { CreateTelemetryDto } from './dto/create-telemetry.dto.js';
import { QueryTelemetryDto } from './dto/query-telemetry.dto.js';

@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    @InjectRepository(TelemetryData)
    private readonly telemetryRepo: Repository<TelemetryData>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    private readonly dataSource: DataSource,
  ) { }

  async onModuleInit() {
    await this.ensureTimescaleDbConfig();
  }

  /**
   * Đảm bảo extension TimescaleDB và Hypertable telemetry_data đã được kích hoạt.
   */
  async ensureTimescaleDbConfig(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // 1. Kiểm tra extension timescaledb
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;');
      this.logger.log('[TimescaleDB] Extension timescaledb sẵn sàng.');

      // 2. Đảm bảo bảng telemetry_data được cấu hình thành Hypertable
      const isHypertableResult = await queryRunner.query(`
        SELECT count(*) as count 
        FROM timescaledb_information.hypertables 
        WHERE hypertable_name = 'telemetry_data';
      `);

      const isHypertable = parseInt(isHypertableResult[0]?.count, 10) > 0;

      if (!isHypertable) {
        await queryRunner.query(`
          SELECT create_hypertable(
            'telemetry_data', 
            'recorded_at', 
            chunk_time_interval => INTERVAL '7 days', 
            if_not_exists => TRUE
          );
        `);
        this.logger.log('[TimescaleDB] Đã khởi tạo Hypertable cho bảng telemetry_data (chu kỳ 7 ngày).');
      } else {
        this.logger.log('[TimescaleDB] Bảng telemetry_data đã là Hypertable.');
      }
    } catch (error) {
      this.logger.error('[TimescaleDB] Lỗi khởi tạo cấu hình TimescaleDB:', error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Xử lý gói tin dữ liệu cảm biến từ MQTT:
   * 1. Kiểm tra thiết bị trong CSDL (Device)
   * 2. Nếu không tìm thấy: Ghi Security Warning Log và từ chối lưu
   * 3. Nếu hợp lệ: Lưu dữ liệu vào TimescaleDB và cập nhật thiết bị sang ONLINE + lastActiveAt
   */
  async processTelemetryPayload(dto: CreateTelemetryDto): Promise<TelemetryData | null> {
    const device = await this.deviceRepo.findOne({ where: { deviceId: dto.deviceId } });

    if (!device) {
      this.logger.warn(
        `[Security Warning] Nhận gói tin từ thiết bị chưa đăng ký trên hệ thống (deviceId: ${dto.deviceId}). Từ chối xử lý dữ liệu.`,
      );
      return null;
    }

    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();

    const telemetryRecord = this.telemetryRepo.create({
      deviceId: dto.deviceId,
      temperature: dto.temperature ?? null,
      ph: dto.ph ?? null,
      salinity: dto.salinity ?? null,
      dissolvedOxygen: dto.dissolvedOxygen ?? null,
      turbidity: dto.turbidity ?? null,
      waterLevel: dto.waterLevel ?? null,
      isBuffered: dto.isBuffered ?? false,
      recordedAt,
    });

    const savedRecord = await this.telemetryRepo.save(telemetryRecord);

    // Cập nhật trạng thái hoạt động thụ động cho thiết bị (Implicit Update)
    await this.deviceRepo.update(dto.deviceId, {
      status: DeviceStatus.ONLINE,
      lastActiveAt: new Date(),
    });

    this.logger.log(
      `[Telemetry] Đã lưu dữ liệu cảm biến cho thiết bị ${dto.deviceId} vào TimescaleDB.`,
    );

    return savedRecord;
  }

  /**
   * Lưu bản ghi dữ liệu cảm biến (trực tiếp)
   */
  async recordTelemetry(data: Partial<TelemetryData>): Promise<TelemetryData> {
    const record = this.telemetryRepo.create(data);
    return await this.telemetryRepo.save(record);
  }

  /**
   * Lấy bản ghi dữ liệu cảm biến mới nhất của một thiết bị
   */
  async getLatestByDeviceId(deviceId: string): Promise<TelemetryData | null> {
    return await this.telemetryRepo.findOne({
      where: { deviceId },
      order: { recordedAt: 'DESC' },
    });
  }

  /**
   * Lấy lịch sử dữ liệu cảm biến của thiết bị theo khoảng thời gian và phân trang
   */
  async getHistoryByDeviceId(
    deviceId: string,
    query: QueryTelemetryDto,
  ): Promise<{ data: TelemetryData[]; total: number }> {
    const { startDate, endDate, limit = 100, page = 1 } = query;
    const skip = (page - 1) * limit;

    const whereConditions: any = { deviceId };

    if (startDate && endDate) {
      whereConditions.recordedAt = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      whereConditions.recordedAt = MoreThanOrEqual(new Date(startDate));
    } else if (endDate) {
      whereConditions.recordedAt = LessThanOrEqual(new Date(endDate));
    }

    const [data, total] = await this.telemetryRepo.findAndCount({
      where: whereConditions,
      order: { recordedAt: 'DESC' },
      take: limit,
      skip,
    });

    return { data, total };
  }
}
