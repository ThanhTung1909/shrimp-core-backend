import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { TelemetryData } from './entities/telemetry-data.entity.js';
import { TelemetryIngestReceipt } from './entities/telemetry-ingest-receipt.entity.js';
import { Device } from '../devices/entities/device.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { CreateTelemetryDto } from './dto/create-telemetry.dto.js';
import { QueryTelemetryDto } from './dto/query-telemetry.dto.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { ThresholdConfig } from '../ponds/entities/threshold-config.entity.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { PondsService } from '../ponds/ponds.service.js';
import { Role } from '../../common/enums/role.enum.js';
import { isHttpOnlyMode } from '../../common/runtime/http-only-mode.js';

const THRESHOLD_COOLDOWN_SECONDS = 15 * 60;
const THRESHOLD_METRICS = [
  { property: 'temperature', normalized: 'temperature' },
  { property: 'ph', normalized: 'ph' },
  { property: 'dissolvedOxygen', normalized: 'dissolvedoxygen' },
  { property: 'salinity', normalized: 'salinity' },
  { property: 'turbidity', normalized: 'turbidity' },
  { property: 'waterLevel', normalized: 'waterlevel' },
] as const;

type ThresholdMetricProperty = (typeof THRESHOLD_METRICS)[number]['property'];

@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    @InjectRepository(TelemetryData)
    private readonly telemetryRepo: Repository<TelemetryData>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(ThresholdConfig)
    private readonly thresholdConfigRepo: Repository<ThresholdConfig>,
    private readonly dataSource: DataSource,
    private readonly alertsService: AlertsService,
    private readonly redisService: RedisService,
    private readonly pondsService: PondsService,
  ) {}

  /**
   * HTTP readers are authorized against the device's pond before any telemetry
   * query. MQTT ingestion deliberately remains on its device/broker boundary.
   */
  async assertDeviceReadAccess(
    deviceId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<void> {
    const device = await this.deviceRepo.findOne({
      where: { deviceId },
      select: { deviceId: true, pondId: true },
    });

    if (!device) {
      throw new NotFoundException('Không tìm thấy thiết bị');
    }
    if (!device.pondId) {
      throw new ForbiddenException('Thiết bị chưa được gán vào ao nuôi được phép truy cập');
    }

    await this.pondsService.findPondById(
      device.pondId,
      currentUserId,
      currentUserRole,
    );
  }

  async onModuleInit() {
    if (isHttpOnlyMode()) {
      this.logger.log('[HTTP-only] Bỏ qua TimescaleDB startup initialization.');
      return;
    }
    await this.ensureTimescaleDbConfig();
  }

  private async findDeviceForTelemetry(
    manager: EntityManager,
    deviceId: string,
  ): Promise<Device | null> {
    // A maintenance transition writes this row. The shared lock orders the
    // threshold decision with that transition without locking a whole pond.
    const device = await manager.findOne(Device, {
      where: { deviceId },
      select: {
        deviceId: true,
        pondId: true,
        status: true,
        lastActiveAt: true,
      },
      lock: { mode: 'pessimistic_read' },
    });
    // PostgreSQL does not permit FOR SHARE on the nullable side of the LEFT
    // JOIN TypeORM emits for Device.pond. Lock the state-bearing Device row
    // first, then load its display/routing context without broadening the lock.
    if (device?.pondId) {
      device.pond = await manager.findOne(Pond, {
        where: { pondId: device.pondId },
        select: { pondId: true, userId: true },
      });
    }
    return device;
  }

  private async persistTelemetryForCurrentDevice(
    manager: EntityManager,
    dto: CreateTelemetryDto,
    recordedAt: Date,
  ): Promise<{ record: TelemetryData; device: Device } | null> {
    const device = await this.findDeviceForTelemetry(manager, dto.deviceId);
    if (!device) return null;

    const isMaintenance = device.status === DeviceStatus.MAINTENANCE;
    const record = await manager.save(manager.create(TelemetryData, {
      deviceId: dto.deviceId,
      messageId: dto.messageId,
      temperature: dto.temperature ?? null,
      ph: dto.ph ?? null,
      salinity: dto.salinity ?? null,
      dissolvedOxygen: dto.dissolvedOxygen ?? null,
      turbidity: dto.turbidity ?? null,
      waterLevel: dto.waterLevel ?? null,
      isBuffered: dto.isBuffered ?? false,
      isMaintenance,
      recordedAt,
    }));

    if (!isMaintenance) {
      await manager.update(Device, dto.deviceId, {
        status: DeviceStatus.ONLINE,
        lastActiveAt: new Date(),
      });
    }

    return { record, device };
  }

  private async evaluateThresholdsForCurrentDevice(
    deviceId: string,
    dto: CreateTelemetryDto,
  ): Promise<void> {
    if (dto.isBuffered) {
      this.logger.debug?.(
        `[Alert Engine] Bỏ qua đánh giá ngưỡng cho telemetry không thời gian thực (isBuffered: true, deviceId: ${deviceId}).`,
      );
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const device = await this.findDeviceForTelemetry(manager, deviceId);
      if (device) await this.evaluateThresholds(device, dto);
    });
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
            if_not_exists => TRUE,
            migrate_data => TRUE
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
   * 3. Nếu hợp lệ: Lưu TimescaleDB, cập nhật thiết bị, publish realtime và đánh giá threshold
   */
  async processTelemetryPayloadWithAck(dto: CreateTelemetryDto): Promise<{
    record: TelemetryData | null;
    acknowledged: boolean;
    duplicate: boolean;
  }> {
    const device = await this.deviceRepo.findOne({
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

    if (!device) {
      this.logger.warn(
        `[Security Warning] Nhận gói tin từ thiết bị chưa đăng ký trên hệ thống (deviceId: ${dto.deviceId}). Từ chối xử lý dữ liệu.`,
      );
      return { record: null, acknowledged: false, duplicate: false };
    }

    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();

    const savedResult = await this.dataSource.transaction(async (manager) => {
      const receiptResult = await manager
        .createQueryBuilder()
        .insert()
        .into(TelemetryIngestReceipt)
        .values({ deviceId: dto.deviceId, messageId: dto.messageId, telemetryId: null })
        .orIgnore()
        // PostgreSQL returns one row only when INSERT actually won the unique
        // constraint. TypeORM's `identifiers` is populated even after
        // `ON CONFLICT DO NOTHING`, so it cannot distinguish a retry.
        .returning('id')
        .execute();

      if (!receiptResult.raw?.length) {
        return { record: null, duplicate: true };
      }

      const persisted = await this.persistTelemetryForCurrentDevice(
        manager,
        dto,
        recordedAt,
      );
      if (!persisted) {
        throw new Error(`Device disappeared before telemetry persistence: ${dto.deviceId}`);
      }
      await manager.update(TelemetryIngestReceipt, {
        deviceId: dto.deviceId,
        messageId: dto.messageId,
      }, { telemetryId: persisted.record.id });

      return { ...persisted, duplicate: false };
    });

    if (savedResult.duplicate || !savedResult.record || !('device' in savedResult)) {
      this.logger.debug?.(
        `[Telemetry] Duplicate acknowledged device=${dto.deviceId} messageId=${dto.messageId}`,
      );
      return { record: null, acknowledged: true, duplicate: true };
    }

    const savedRecord = savedResult.record;
    const savedDevice = savedResult.device;

    this.logger.log(
      `[Telemetry] Đã lưu dữ liệu cảm biến cho thiết bị ${dto.deviceId} vào TimescaleDB.`,
    );

    try {
      await this.redisService.publish(
        'telemetry:new',
        JSON.stringify({
          pondId: savedDevice.pondId,
          userId: savedDevice.pond?.userId || null,
          data: savedRecord,
        }),
      );
    } catch (err: any) {
      this.logger.error(`[Redis Publish Error] Lỗi publish telemetry:new: ${err.message}`);
    }

    await this.evaluateThresholdsForCurrentDevice(dto.deviceId, dto);

    return { record: savedRecord, acknowledged: true, duplicate: false };
  }

  /** Legacy ingestion API retained for existing REST/unit-test callers. MQTT
   * uses processTelemetryPayloadWithAck() so its receipt and telemetry rows
   * are committed atomically before an application ACK is emitted. */
  async processTelemetryPayload(dto: CreateTelemetryDto): Promise<TelemetryData | null> {
    const device = await this.deviceRepo.findOne({
      where: { deviceId: dto.deviceId },
      relations: { pond: true },
      select: {
        deviceId: true, pondId: true, status: true, lastActiveAt: true,
        pond: { pondId: true, userId: true },
      },
    });
    if (!device) {
      this.logger.warn(`[Security Warning] Nhận gói tin từ thiết bị chưa đăng ký trên hệ thống (deviceId: ${dto.deviceId}). Từ chối xử lý dữ liệu.`);
      return null;
    }
    const savedResult = await this.dataSource.transaction((manager) =>
      this.persistTelemetryForCurrentDevice(
        manager,
        dto,
        dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      ),
    );
    if (!savedResult) {
      this.logger.warn(`[Security Warning] Thiết bị ${dto.deviceId} biến mất trước khi lưu telemetry.`);
      return null;
    }
    const savedRecord = savedResult.record;
    try {
      await this.redisService.publish('telemetry:new', JSON.stringify({
        pondId: savedResult.device.pondId, userId: savedResult.device.pond?.userId || null, data: savedRecord,
      }));
    } catch (err: any) {
      this.logger.error(`[Redis Publish Error] Lỗi publish telemetry:new: ${err.message}`);
    }
    await this.evaluateThresholdsForCurrentDevice(dto.deviceId, dto);
    return savedRecord;
  }

  private normalizeMetricName(metricName: string): string {
    const normalized = metricName.toLowerCase().replace(/[\s_-]/g, '');
    if (normalized === 'temp') return 'temperature';
    if (normalized === 'do') return 'dissolvedoxygen';
    return normalized;
  }

  async getThresholdConfigsForPond(pondId: string): Promise<ThresholdConfig[]> {
    const cacheKey = `cache:thresholds:${pondId}`;
    if (this.redisService && typeof this.redisService.get === 'function') {
      try {
        const cached = await this.redisService.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err: any) {
        this.logger.warn(`[Redis Cache Error] Không thể đọc cache ${cacheKey}: ${err.message}`);
      }
    }

    const configs = await this.thresholdConfigRepo.find({
      where: { pondId, isActive: true },
    });

    if (this.redisService && typeof this.redisService.set === 'function') {
      try {
        await this.redisService.set(cacheKey, JSON.stringify(configs), 15 * 60);
      } catch (err: any) {
        this.logger.warn(`[Redis Cache Error] Không thể ghi cache ${cacheKey}: ${err.message}`);
      }
    }

    return configs;
  }

  determineAlertLevel(
    normalizedMetric: string,
    value: number,
    minValue: number,
    maxValue: number,
    direction: 'LOW' | 'HIGH',
  ): AlertLevel {
    const boundary = direction === 'LOW' ? minValue : maxValue;
    const deviation = Math.abs(value - boundary);
    const deviationPercent = boundary !== 0 ? deviation / boundary : 0;

    // Ngưỡng nguy cấp ngành tôm:
    // 1. Oxy hòa tan DO < 3.0 mg/L (tôm ngạt khí)
    // 2. pH < 6.8 hoặc pH > 9.2 (sốc môi trường nặng)
    // 3. Hoặc mức lệch ngưỡng >= 25%
    if (
      (normalizedMetric === 'dissolvedoxygen' && value < 3.0) ||
      (normalizedMetric === 'ph' && (value < 6.8 || value > 9.2)) ||
      deviationPercent >= (0.25 - Number.EPSILON)
    ) {
      return AlertLevel.CRITICAL;
    }

    return AlertLevel.WARNING;
  }

  async evaluateThresholds(
    deviceOrId: Device | string,
    dto: CreateTelemetryDto,
  ): Promise<void> {
    const device =
      typeof deviceOrId === 'string'
        ? await this.deviceRepo.findOne({ where: { deviceId: deviceOrId } })
        : deviceOrId;

    if (!device || !device.pondId) return;

    if (dto.isBuffered || device.status === DeviceStatus.MAINTENANCE) {
      this.logger.debug?.(
        `[Alert Engine] Bỏ qua đánh giá ngưỡng cho telemetry không thời gian thực (isBuffered: ${dto.isBuffered === true}, status: ${device.status}, deviceId: ${device.deviceId}).`,
      );
      return;
    }

    try {
      const configs = await this.getThresholdConfigsForPond(device.pondId);
      const configsByMetric = new Map<string, ThresholdConfig>();
      for (const config of configs) {
        if (!config.isActive) continue;
        const normalizedName = this.normalizeMetricName(config.metricName);
        if (!configsByMetric.has(normalizedName)) {
          configsByMetric.set(normalizedName, config);
        }
      }

      for (const metric of THRESHOLD_METRICS) {
        const value = dto[metric.property as ThresholdMetricProperty];
        if (value === null || value === undefined) continue;

        const config = configsByMetric.get(metric.normalized);
        if (!config) continue;

        const numericValue = Number(value);
        const minValue = Number(config.minValue);
        const maxValue = Number(config.maxValue);

        if (
          !Number.isFinite(numericValue) ||
          !Number.isFinite(minValue) ||
          !Number.isFinite(maxValue)
        ) {
          continue;
        }

        if (minValue > maxValue) {
          this.logger.warn(
            `[Alert Engine] Cấu hình ngưỡng không hợp lệ cho ao ${device.pondId}, chỉ số ${config.metricName}: minValue (${minValue}) > maxValue (${maxValue}). Bỏ qua.`,
          );
          continue;
        }

        const direction =
          numericValue < minValue ? 'LOW' : numericValue > maxValue ? 'HIGH' : null;
        if (!direction) continue;

        await this.createThresholdAlert(
          device,
          config,
          metric.normalized,
          numericValue,
          direction,
        );
      }
    } catch (error) {
      this.logger.error(
        `[Alert Engine] Không thể đánh giá ngưỡng cho thiết bị ${device.deviceId}; dữ liệu telemetry đã được lưu.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async createThresholdAlert(
    device: Device,
    config: ThresholdConfig,
    normalizedMetric: string,
    triggeredValue: number,
    direction: 'LOW' | 'HIGH',
  ): Promise<void> {
    const cooldownKey = `alert:cooldown:${config.pondId}:${device.deviceId}:${normalizedMetric}:${direction}`;
    const alertLevel = this.determineAlertLevel(
      normalizedMetric,
      triggeredValue,
      Number(config.minValue),
      Number(config.maxValue),
      direction,
    );

    // Default is safe for a Redis failure before any reservation is made.
    let reservation: 'created' | 'escalated' | 'suppressed' = 'suppressed';

    try {
      reservation = await this.redisService.reserveAlertCooldown(
        cooldownKey,
        alertLevel,
        THRESHOLD_COOLDOWN_SECONDS,
      );
      if (reservation === 'suppressed') return;
      if (reservation === 'escalated') {
        this.logger.warn(
          `[Alert Engine Escalation] Atomic escalation to CRITICAL for pond ${config.pondId || device.pondId}, device ${device.deviceId}, metric ${config.metricName} (value: ${triggeredValue}).`,
        );
      }

      await this.alertsService.createThresholdAlert({
        pondId: config.pondId,
        deviceId: device.deviceId,
        metricName: config.metricName,
        triggeredValue,
        minValue: Number(config.minValue),
        maxValue: Number(config.maxValue),
        direction,
        alertLevel,
      });

    } catch (error) {
      if (reservation === 'created') {
        try {
          await this.redisService.del(cooldownKey, `${cooldownKey}:level`);
        } catch (cleanupError) {
          this.logger.error(
            `[Alert Engine] Không thể xóa cooldown lỗi cho ${cooldownKey}.`,
            cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
          );
        }
      }
      throw error;
    }
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
      where: { deviceId, isMaintenance: false },
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

  async updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<Device | null> {
    const device = await this.deviceRepo.findOne({
      where: { deviceId },
      relations: { pond: true },
      select: {
        deviceId: true,
        deviceName: true,
        pondId: true,
        status: true,
        lastActiveAt: true,
        pond: {
          pondId: true,
          userId: true,
        },
      },
    });
    if (!device) {
      return null;
    }

    device.status = status;
    if (status === DeviceStatus.ONLINE) {
      device.lastActiveAt = new Date();
    }
    const updatedDevice = await this.deviceRepo.save(device);

    if (status === DeviceStatus.OFFLINE && device.pondId) {
      const activeAlert = await this.alertRepo.findOne({
        where: {
          pondId: device.pondId,
          metricName: 'device_status',
          status: AlertStatus.ACTIVE,
          alertLevel: AlertLevel.CRITICAL,
        },
        order: { createdAt: 'DESC' },
      });

      if (!activeAlert) {
        await this.alertsService.createAlert({
          pondId: device.pondId,
          deviceId: device.deviceId,
          metricName: 'device_status',
          triggeredValue: 0,
          alertLevel: AlertLevel.CRITICAL,
          status: AlertStatus.ACTIVE,
          message: `Thiết bị ${device.deviceName || device.deviceId} mất kết nối mạng đột ngột hoặc quá hạn phản hồi`,
        });
      }
    }

    return updatedDevice;
  }

  async checkAndMarkOfflineDevices(timeoutMinutes: number = 15): Promise<number> {
    const thresholdDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const offlineDevices = await this.deviceRepo.find({
      where: {
        status: DeviceStatus.ONLINE,
        lastActiveAt: LessThanOrEqual(thresholdDate),
      },
    });

    let updatedCount = 0;
    for (const device of offlineDevices) {
      await this.updateDeviceStatus(device.deviceId, DeviceStatus.OFFLINE);
      updatedCount++;
    }

    return updatedCount;
  }
}
