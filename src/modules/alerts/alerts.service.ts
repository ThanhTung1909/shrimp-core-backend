import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './entities/alert.entity.js';
import { QueryAlertDto } from './dto/query-alert.dto.js';
import { ResolveAlertDto } from './dto/resolve-alert.dto.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service.js';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @Optional()
    private readonly notificationDispatcher?: NotificationDispatcherService,
  ) {}

  async createAlert(alertData: Partial<Alert>): Promise<Alert> {
    const alert = this.alertRepo.create(alertData);
    const saved = await this.alertRepo.save(alert);

    if (this.notificationDispatcher) {
      void this.notificationDispatcher.dispatchAlert(saved).catch((err: any) => {
        this.logger.error(`[AlertsService] Dispatch alert error: ${err.message}`);
      });
    }

    return saved;
  }

  async findAll(query: QueryAlertDto): Promise<{ data: Alert[]; total: number }> {
    const { page = 1, limit = 20, deviceId, isResolved } = query;
    const skip = (page - 1) * limit;

    const qb = this.alertRepo.createQueryBuilder('alert');
    qb.leftJoinAndSelect('alert.pond', 'pond');
    qb.leftJoinAndSelect('alert.device', 'device');

    if (deviceId) {
      qb.andWhere('alert.device_id = :deviceId', { deviceId });
    }

    if (isResolved !== undefined) {
      const status = isResolved ? AlertStatus.RESOLVED : AlertStatus.ACTIVE;
      qb.andWhere('alert.status = :status', { status });
    }

    qb.orderBy('alert.created_at', 'DESC');
    qb.skip(skip);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async resolveAlert(
    alertId: string,
    userId: string,
    dto: ResolveAlertDto,
  ): Promise<Alert> {
    const alert = await this.alertRepo.findOne({ where: { alertId } });
    if (!alert) {
      throw new NotFoundException(`Không tìm thấy cảnh báo với ID: ${alertId}`);
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedById = userId;
    alert.resolvedAt = new Date();

    if (dto.resolutionNote) {
      alert.resolutionNote = dto.resolutionNote;
    }

    return await this.alertRepo.save(alert);
  }
}
