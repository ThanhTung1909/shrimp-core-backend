import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './entities/alert.entity.js';
import { QueryAlertDto } from './dto/query-alert.dto.js';
import { ResolveAlertDto } from './dto/resolve-alert.dto.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { Role } from '../../common/enums/role.enum.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service.js';

export interface CreateThresholdAlertInput {
  pondId: string;
  deviceId: string;
  metricName: string;
  triggeredValue: number;
  minValue: number;
  maxValue: number;
  direction: 'LOW' | 'HIGH';
  alertLevel?: AlertLevel;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    private readonly redisService: RedisService,
    @Optional()
    private readonly notificationDispatcher?: NotificationDispatcherService,
  ) {}

  async createAlert(alertData: Partial<Alert>): Promise<Alert> {
    const alert = this.alertRepo.create(alertData);
    const saved = await this.alertRepo.save(alert);
    await this.publishAlertTriggered(saved);
    return saved;
  }

  async createThresholdAlert(input: CreateThresholdAlertInput): Promise<Alert> {
    const boundary = input.direction === 'LOW' ? input.minValue : input.maxValue;
    const comparison = input.direction === 'LOW' ? 'thấp hơn' : 'cao hơn';
    const alertLevel = input.alertLevel || AlertLevel.WARNING;
    const alert = this.alertRepo.create({
      pondId: input.pondId,
      deviceId: input.deviceId,
      metricName: input.metricName,
      triggeredValue: input.triggeredValue,
      alertLevel,
      status: AlertStatus.ACTIVE,
      message: `Chỉ số ${input.metricName} đo được ${input.triggeredValue}, ${comparison} ngưỡng ${boundary} (khoảng cho phép ${input.minValue} - ${input.maxValue}).`,
    });

    const saved = await this.alertRepo.save(alert);
    await this.publishAlertTriggered(saved);
    return saved;
  }

  /**
   * Persist-first outbox boundary for alert consumers. Notification dispatch is
   * intentionally performed only by AlertNotificationListener after this event.
   */
  private async publishAlertTriggered(alert: Alert): Promise<void> {
    try {
      await this.redisService.publish(
        'alert:triggered',
        JSON.stringify({ pondId: alert.pondId, alert }),
      );
    } catch {
      // The alert is durable even when Redis is transiently unavailable; do
      // not make telemetry persistence fail because a downstream consumer did.
      this.logger.error('[AlertsService] Unable to publish alert:triggered event.');
      // Redis Pub/Sub is not durable. The fallback uses the same dispatcher;
      // its database claim makes a rare publish-then-error outcome safe.
      if (this.notificationDispatcher) {
        void this.notificationDispatcher.dispatchAlert(alert).catch(() => {
          this.logger.error('[AlertsService] Notification dispatch fallback failed.');
        });
      }
    }
  }

  async findAll(
    query: QueryAlertDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{ data: Alert[]; total: number }> {
    this.assertSupportedRole(currentUserRole);
    const { page = 1, limit = 20, pondId, deviceId, isResolved, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const qb = this.alertRepo.createQueryBuilder('alert');
    qb.leftJoinAndSelect('alert.pond', 'pond');
    qb.leftJoinAndSelect('alert.device', 'device');

    if (currentUserRole === Role.FARMER) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM pond_farmer_assignments pfa WHERE pfa.pond_id = pond.pond_id AND pfa.farmer_id = :currentUserId)',
        { currentUserId },
      );
    } else if (currentUserRole === Role.MANAGER) {
      qb.leftJoin('farms', 'farm', 'farm.farm_id = pond.farm_id');
      qb.andWhere(
        'farm.owner_id = :currentUserId',
        { currentUserId },
      );
    }

    if (pondId) {
      qb.andWhere('alert.pond_id = :pondId', { pondId });
    }

    if (deviceId) {
      qb.andWhere('alert.device_id = :deviceId', { deviceId });
    }

    if (isResolved !== undefined) {
      const status = isResolved ? AlertStatus.RESOLVED : AlertStatus.ACTIVE;
      qb.andWhere('alert.status = :status', { status });
    }

    if (startDate) {
      qb.andWhere('alert.createdAt >= :startDate', { startDate: new Date(startDate) });
    }

    if (endDate) {
      qb.andWhere('alert.createdAt <= :endDate', { endDate: new Date(endDate) });
    }

    qb.orderBy('alert.createdAt', 'DESC');
    qb.skip(skip);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async resolveAlert(
    alertId: string,
    userId: string,
    dto: ResolveAlertDto,
    currentUserRole: Role,
  ): Promise<Alert> {
    this.assertSupportedRole(currentUserRole);
    const alert = await this.alertRepo.findOne({
      where: { alertId },
      relations: { pond: true },
    });
    if (!alert) {
      throw new NotFoundException(`Không tìm thấy cảnh báo với ID: ${alertId}`);
    }

    if (currentUserRole === Role.FARMER) {
      const assignmentCount = alert.pond?.pondId
        ? await this.alertRepo.manager.query(
          'SELECT 1 FROM pond_farmer_assignments WHERE pond_id = $1 AND farmer_id = $2 LIMIT 1',
          [alert.pond.pondId, userId],
        )
        : [];
      if (!assignmentCount?.length) {
        throw new ForbiddenException('Bạn không có quyền xử lý cảnh báo này!');
      }
    } else if (currentUserRole === Role.MANAGER) {
      const farmCount = alert.pond?.farmId
        ? await this.alertRepo.manager.query(
          'SELECT 1 FROM farms WHERE farm_id = $1 AND owner_id = $2 LIMIT 1',
          [alert.pond.farmId, userId],
        )
        : [];
      if (!farmCount?.length) {
        throw new ForbiddenException('Bạn không có quyền xử lý cảnh báo này!');
      }
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedById = userId;
    alert.resolvedAt = new Date();

    if (dto.resolutionNote) {
      alert.resolutionNote = dto.resolutionNote;
    }

    return await this.alertRepo.save(alert);
  }

  private assertSupportedRole(role: Role): void {
    if (role !== Role.ADMIN && role !== Role.MANAGER && role !== Role.FARMER) {
      throw new ForbiddenException('Vai trò người dùng không được phép truy cập cảnh báo!');
    }
  }
}
