import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './entities/alert.entity.js';
import { QueryAlertDto } from './dto/query-alert.dto.js';
import { ResolveAlertDto } from './dto/resolve-alert.dto.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { Role } from '../../common/enums/role.enum.js';

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
  ) {}

  async findAll(query: QueryAlertDto & { userId?: string }): Promise<{ data: Alert[]; total: number }> {
    const { page = 1, limit = 20, deviceId, isResolved, userId } = query;
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

    if (userId) {
      qb.andWhere('pond.user_id = :userId', { userId });
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
    role?: Role,
  ): Promise<Alert> {
    const alert = await this.alertRepo.findOne({ where: { alertId }, relations: { pond: true } });
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
