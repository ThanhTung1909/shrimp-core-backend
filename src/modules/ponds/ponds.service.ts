import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  ILike,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Pond } from './entities/pond.entity.js';
import { ThresholdConfig } from './entities/threshold-config.entity.js';
import { ManualTestLog } from './entities/manual-test-log.entity.js';
import { CreatePondDto } from './dto/create-pond.dto.js';
import { UpdatePondDto } from './dto/update-pond.dto.js';
import { FindPondsQueryDto } from './dto/find-ponds-query.dto.js';
import { CreateThresholdConfigDto } from './dto/create-threshold-config.dto.js';
import { UpdateThresholdConfigDto } from './dto/update-threshold-config.dto.js';
import { CreateManualTestLogDto } from './dto/create-manual-test-log.dto.js';
import { UpdateManualTestLogDto } from './dto/update-manual-test-log.dto.js';
import { FindManualTestLogsQueryDto } from './dto/find-manual-test-logs-query.dto.js';
import { Role } from '../../common/enums/role.enum.js';

@Injectable()
export class PondsService {
  constructor(
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
    @InjectRepository(ThresholdConfig)
    private readonly thresholdRepo: Repository<ThresholdConfig>,
    @InjectRepository(ManualTestLog)
    private readonly manualLogRepo: Repository<ManualTestLog>,
  ) {}

  // ==========================================
  // 1. POND CRUD
  // ==========================================

  async createPond(
    createPondDto: CreatePondDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Pond> {
    const targetUserId =
      currentUserRole === Role.MANAGER && createPondDto.userId
        ? createPondDto.userId
        : currentUserId;

    const newPond = this.pondRepo.create({
      ...createPondDto,
      userId: targetUserId,
    });

    return await this.pondRepo.save(newPond);
  }

  async findAllPonds(
    query: FindPondsQueryDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{
    data: Pond[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 10, search, status, userId } = query;
    const skip = (page - 1) * limit;

    const effectiveUserId =
      currentUserRole === Role.FARMER ? currentUserId : userId;

    let where: FindOptionsWhere<Pond>[] | FindOptionsWhere<Pond> = {};

    if (search) {
      where = [
        {
          pondName: ILike(`%${search}%`),
          ...(status ? { status } : {}),
          ...(effectiveUserId ? { userId: effectiveUserId } : {}),
        },
      ];
    } else {
      where = {
        ...(status ? { status } : {}),
        ...(effectiveUserId ? { userId: effectiveUserId } : {}),
      };
    }

    const [data, total] = await this.pondRepo.findAndCount({
      where,
      relations: {
        user: true,
        devices: true,
        thresholdConfigs: true,
      },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findPondById(
    pondId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Pond> {
    const pond = await this.pondRepo.findOne({
      where: { pondId },
      relations: {
        user: true,
        devices: true,
        thresholdConfigs: true,
        manualLogs: true,
      },
    });

    if (!pond) {
      throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${pondId}`);
    }

    if (currentUserRole === Role.FARMER && pond.userId !== currentUserId) {
      throw new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!');
    }

    return pond;
  }

  async updatePond(
    pondId: string,
    updatePondDto: UpdatePondDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Pond> {
    const pond = await this.findPondById(
      pondId,
      currentUserId,
      currentUserRole,
    );

    if (updatePondDto.userId && currentUserRole === Role.MANAGER) {
      pond.userId = updatePondDto.userId;
    }
    if (updatePondDto.pondName !== undefined) {
      pond.pondName = updatePondDto.pondName;
    }
    if (updatePondDto.areaM2 !== undefined) {
      pond.areaM2 = updatePondDto.areaM2;
    }
    if (updatePondDto.depthM !== undefined) {
      pond.depthM = updatePondDto.depthM;
    }
    if (updatePondDto.shrimpDensity !== undefined) {
      pond.shrimpDensity = updatePondDto.shrimpDensity;
    }
    if (updatePondDto.status !== undefined) {
      pond.status = updatePondDto.status;
    }

    return await this.pondRepo.save(pond);
  }

  async deletePond(
    pondId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{ message: string }> {
    const pond = await this.findPondById(
      pondId,
      currentUserId,
      currentUserRole,
    );
    await this.pondRepo.remove(pond);
    return { message: 'Xóa ao nuôi thành công!' };
  }

  // ==========================================
  // 2. THRESHOLD CONFIG CRUD
  // ==========================================

  async createThresholdConfig(
    pondId: string,
    dto: CreateThresholdConfigDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ThresholdConfig> {
    await this.findPondById(pondId, currentUserId, currentUserRole);

    if (dto.minValue > dto.maxValue) {
      throw new BadRequestException(
        'Giá trị tối thiểu (minValue) không được lớn hơn giá trị tối đa (maxValue)!',
      );
    }

    const config = this.thresholdRepo.create({
      ...dto,
      pondId,
    });

    return await this.thresholdRepo.save(config);
  }

  async findThresholdsByPond(
    pondId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<any[]> {
    await this.findPondById(pondId, currentUserId, currentUserRole);
    const configs = await this.thresholdRepo.find({
      where: { pondId },
      order: { metricName: 'ASC' },
    });

    const METRIC_META: Record<string, { unit: string; color: string; dangerFactor: number }> = {
      pH: { unit: '', color: '#2dd4c3', dangerFactor: 0.8 },
      DO: { unit: 'mg/L', color: '#38bdf8', dangerFactor: 0.7 },
      dissolvedOxygen: { unit: 'mg/L', color: '#38bdf8', dangerFactor: 0.7 },
      temperature: { unit: '°C', color: '#f59e0b', dangerFactor: 0.8 },
      temp: { unit: '°C', color: '#f59e0b', dangerFactor: 0.8 },
      salinity: { unit: 'ppt', color: '#a855f7', dangerFactor: 0.7 },
      turbidity: { unit: 'NTU', color: '#ec4899', dangerFactor: 0.8 },
      waterLevel: { unit: 'm', color: '#6366f1', dangerFactor: 0.8 },
    };

    return configs.map((c) => {
      const meta = METRIC_META[c.metricName] || { unit: '', color: '#38bdf8', dangerFactor: 0.8 };
      const normalMin = Number(c.minValue);
      const normalMax = Number(c.maxValue);
      const dangerMin = Number((normalMin * meta.dangerFactor).toFixed(1));
      const dangerMax = Number((normalMax * (2 - meta.dangerFactor)).toFixed(1));

      return {
        ...c,
        id: c.configId,
        parameterId: c.metricName,
        parameterName: c.metricName,
        unit: meta.unit,
        color: meta.color,
        normalMin,
        normalMax,
        dangerMin,
        dangerMax,
      };
    });
  }

  async updateThresholdConfig(
    configId: string,
    dto: UpdateThresholdConfigDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ThresholdConfig> {
    const config = await this.thresholdRepo.findOne({
      where: { configId },
      relations: {
        pond: true,
      },
    });

    if (!config) {
      throw new NotFoundException(
        `Không tìm thấy cấu hình ngưỡng với ID: ${configId}`,
      );
    }

    if (
      currentUserRole === Role.FARMER &&
      config.pond.userId !== currentUserId
    ) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa cấu hình này!');
    }

    const newMin = dto.minValue !== undefined ? dto.minValue : config.minValue;
    const newMax = dto.maxValue !== undefined ? dto.maxValue : config.maxValue;

    if (newMin > newMax) {
      throw new BadRequestException(
        'Giá trị tối thiểu (minValue) không được lớn hơn giá trị tối đa (maxValue)!',
      );
    }

    if (dto.metricName !== undefined) config.metricName = dto.metricName;
    if (dto.minValue !== undefined) config.minValue = dto.minValue;
    if (dto.maxValue !== undefined) config.maxValue = dto.maxValue;
    if (dto.isActive !== undefined) config.isActive = dto.isActive;

    return await this.thresholdRepo.save(config);
  }

  async deleteThresholdConfig(
    configId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{ message: string }> {
    const config = await this.thresholdRepo.findOne({
      where: { configId },
      relations: {
        pond: true,
      },
    });

    if (!config) {
      throw new NotFoundException(
        `Không tìm thấy cấu hình ngưỡng với ID: ${configId}`,
      );
    }

    if (
      currentUserRole === Role.FARMER &&
      config.pond.userId !== currentUserId
    ) {
      throw new ForbiddenException('Bạn không có quyền xóa cấu hình này!');
    }

    await this.thresholdRepo.remove(config);
    return { message: 'Xóa cấu hình ngưỡng thành công!' };
  }

  // ==========================================
  // 3. MANUAL TEST LOG CRUD
  // ==========================================

  async createManualTestLog(
    pondId: string,
    dto: CreateManualTestLogDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ManualTestLog> {
    await this.findPondById(pondId, currentUserId, currentUserRole);

    const log = this.manualLogRepo.create({
      ...dto,
      pondId,
      testedById: currentUserId,
      testedAt: dto.testedAt ? new Date(dto.testedAt) : new Date(),
    });

    return await this.manualLogRepo.save(log);
  }

  async findManualLogsByPond(
    pondId: string,
    query: FindManualTestLogsQueryDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{
    data: ManualTestLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    await this.findPondById(pondId, currentUserId, currentUserRole);

    const { page = 1, limit = 10, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<ManualTestLog> = { pondId };

    if (startDate && endDate) {
      where = {
        ...where,
        testedAt: Between(new Date(startDate), new Date(endDate)),
      };
    } else if (startDate) {
      where = {
        ...where,
        testedAt: MoreThanOrEqual(new Date(startDate)),
      };
    } else if (endDate) {
      where = {
        ...where,
        testedAt: LessThanOrEqual(new Date(endDate)),
      };
    }

    const [data, total] = await this.manualLogRepo.findAndCount({
      where,
      relations: {
        testedBy: true,
      },
      order: { testedAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findManualLogById(
    logId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ManualTestLog> {
    const log = await this.manualLogRepo.findOne({
      where: { logId },
      relations: {
        pond: true,
        testedBy: true,
      },
    });

    if (!log) {
      throw new NotFoundException(
        `Không tìm thấy bản ghi đo thủ công với ID: ${logId}`,
      );
    }

    if (currentUserRole === Role.FARMER && log.pond.userId !== currentUserId) {
      throw new ForbiddenException('Bạn không có quyền truy cập bản ghi này!');
    }

    return log;
  }

  async updateManualTestLog(
    logId: string,
    dto: UpdateManualTestLogDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ManualTestLog> {
    const log = await this.findManualLogById(
      logId,
      currentUserId,
      currentUserRole,
    );

    if (dto.nh3Value !== undefined) log.nh3Value = dto.nh3Value;
    if (dto.no2Value !== undefined) log.no2Value = dto.no2Value;
    if (dto.note !== undefined) log.note = dto.note;
    if (dto.testedAt !== undefined) log.testedAt = new Date(dto.testedAt);

    return await this.manualLogRepo.save(log);
  }

  async deleteManualTestLog(
    logId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{ message: string }> {
    const log = await this.findManualLogById(
      logId,
      currentUserId,
      currentUserRole,
    );
    await this.manualLogRepo.remove(log);
    return { message: 'Xóa bản ghi đo thủ công thành công!' };
  }
}
