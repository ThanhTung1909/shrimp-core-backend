import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
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
import { Farm } from '../farms/entities/farm.entity.js';
import { User } from '../users/entities/user.entity.js';
import { PondFarmerAssignment } from './entities/pond-farmer-assignment.entity.js';
import { CreatePondDto } from './dto/create-pond.dto.js';
import { UpdatePondDto } from './dto/update-pond.dto.js';
import { FindPondsQueryDto } from './dto/find-ponds-query.dto.js';
import { CreateThresholdConfigDto } from './dto/create-threshold-config.dto.js';
import { UpdateThresholdConfigDto } from './dto/update-threshold-config.dto.js';
import { CreateManualTestLogDto } from './dto/create-manual-test-log.dto.js';
import { UpdateManualTestLogDto } from './dto/update-manual-test-log.dto.js';
import { FindManualTestLogsQueryDto } from './dto/find-manual-test-logs-query.dto.js';
import { Role } from '../../common/enums/role.enum.js';
import { RedisService } from '../../common/redis/redis.service.js';
import {
  MessageOnlyResponse,
  PaginatedResponse,
  ThresholdMetricMetadata,
  ThresholdResponse,
} from './dto/pond-response.dto.js';

@Injectable()
export class PondsService {
  constructor(
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
    @InjectRepository(ThresholdConfig)
    private readonly thresholdRepo: Repository<ThresholdConfig>,
    @InjectRepository(ManualTestLog)
    private readonly manualLogRepo: Repository<ManualTestLog>,
    @InjectRepository(Farm)
    private readonly farmRepo: Repository<Farm>,
    @InjectRepository(User)
    private readonly userRepo?: Repository<User>,
    @InjectRepository(PondFarmerAssignment)
    private readonly assignmentRepo?: Repository<PondFarmerAssignment>,
    @Optional()
    private readonly redisService?: RedisService,
  ) {}

  private async invalidateThresholdCache(pondId: string): Promise<void> {
    if (this.redisService && typeof this.redisService.del === 'function') {
      try {
        await this.redisService.del(`cache:thresholds:${pondId}`);
      } catch {
        // Safe ignore cache deletion error
      }
    }
  }

  private async assertPondAccess(
    pond: Pond,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<void> {
    if (currentUserRole === Role.ADMIN) return;
    if (currentUserRole === Role.MANAGER) {
      if (pond.userId !== currentUserId && this.assignmentRepo)
        throw new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!');
      return;
    }
    if (
      currentUserRole !== Role.FARMER ||
      !(this.assignmentRepo
        ? await this.assignmentRepo.exist({
        where: { pondId: pond.pondId, farmerId: currentUserId },
        })
        : pond.userId === currentUserId)
    ) {
      throw new ForbiddenException('Bạn không được phân công cho ao nuôi này!');
    }
  }

  private async assertPondManager(
    pond: Pond,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<void> {
    if (this.assignmentRepo && currentUserRole !== Role.ADMIN &&
      (currentUserRole !== Role.MANAGER || pond.userId !== currentUserId)) {
      throw new ForbiddenException('Chỉ chủ ao mới có quyền quản lý ao nuôi này!');
    }
  }

  /**
   * FARMERs can record measurements for ponds to which they are assigned, but
   * editing or deleting the operational history remains a manager action.
   */
  private async assertManualLogManager(
    pond: Pond,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<void> {
    await this.assertPondAccess(pond, currentUserId, currentUserRole);
    await this.assertPondManager(pond, currentUserId, currentUserRole);
  }

  private withoutSensitiveUserFields<T extends Record<string, unknown>>(
    user: T | null | undefined,
  ): T | null | undefined {
    if (!user) return user;
    const { passwordHash: _passwordHash, fcmToken: _fcmToken, email: _email,
      phoneNumber: _phoneNumber, tokenVersion: _tokenVersion,
      isLocked: _isLocked, mustChangePassword: _mustChangePassword, ...safeUser } = user;
    return safeUser as T;
  }

  private sanitizePond(pond: Pond): Pond {
    if (!pond.user) return pond;
    return {
      ...pond,
      user: this.withoutSensitiveUserFields(pond.user as unknown as Record<string, unknown>),
    } as unknown as Pond;
  }

  private sanitizeManualLog(log: ManualTestLog): ManualTestLog {
    if (!log.testedBy) return log;
    return {
      ...log,
      testedBy: this.withoutSensitiveUserFields(log.testedBy as unknown as Record<string, unknown>),
    } as unknown as ManualTestLog;
  }

  // ==========================================
  // 1. POND CRUD
  // ==========================================

  async createPond(
    createPondDto: CreatePondDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Pond> {
    const existingPond = await this.pondRepo.findOne({
      where: { pondName: createPondDto.pondName },
    });

    if (existingPond) {
      throw new ConflictException('Tên ao nuôi đã tồn tại!');
    }

    if (this.assignmentRepo && currentUserRole !== Role.ADMIN && currentUserRole !== Role.MANAGER)
      throw new ForbiddenException('Chỉ MANAGER mới có quyền tạo ao nuôi!');
    const targetUserId = (currentUserRole === Role.ADMIN ||
      (!this.assignmentRepo && currentUserRole === Role.MANAGER)) && createPondDto.userId
      ? createPondDto.userId
      : currentUserId;

    if (createPondDto.farmId) {
      const farm = await this.farmRepo.findOneBy({ farmId: createPondDto.farmId });
      if (!farm) throw new NotFoundException('Không tìm thấy trại nuôi');
      if (farm.ownerId !== targetUserId) throw new BadRequestException('Ao nuôi phải thuộc cùng chủ sở hữu với trại nuôi');
    }

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
  ): Promise<PaginatedResponse<Pond>> {
    const { page = 1, limit = 10, search, status, userId } = query;
    const skip = (page - 1) * limit;

    if (currentUserRole === Role.FARMER && this.assignmentRepo) {
      const qb = this.pondRepo
        .createQueryBuilder('pond')
        .innerJoin('pond_farmer_assignments', 'assignment',
          'assignment.pond_id = pond.pond_id AND assignment.farmer_id = :userId',
          { userId: currentUserId })
        .leftJoinAndSelect('pond.user', 'user')
        .leftJoinAndSelect('pond.devices', 'devices')
        .leftJoinAndSelect('pond.thresholdConfigs', 'thresholdConfigs');
      if (search) qb.andWhere('pond.pond_name ILIKE :search', { search: `%${search}%` });
      if (status) qb.andWhere('pond.status = :status', { status });
      const [data, total] = await qb.orderBy('pond.created_at', 'DESC').skip(skip).take(limit).getManyAndCount();
      return { data: data.map((pond) => this.sanitizePond(pond)), total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    const effectiveUserId = currentUserRole === Role.MANAGER && this.assignmentRepo ? currentUserId
      : currentUserRole === Role.FARMER ? currentUserId : userId;

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
      data: data.map((pond) => this.sanitizePond(pond)),
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

    await this.assertPondAccess(pond, currentUserId, currentUserRole);

    return this.sanitizePond(pond);
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

    await this.assertPondManager(pond, currentUserId, currentUserRole);

    if (updatePondDto.userId &&
      (currentUserRole === Role.ADMIN ||
        (!this.assignmentRepo && currentUserRole === Role.MANAGER))) {
      pond.userId = updatePondDto.userId;
    }
    if (
      updatePondDto.pondName !== undefined &&
      updatePondDto.pondName !== pond.pondName
    ) {
      const existingPond = await this.pondRepo.findOne({
        where: { pondName: updatePondDto.pondName },
      });

      if (existingPond && existingPond.pondId !== pondId) {
        throw new ConflictException('Tên ao nuôi đã tồn tại!');
      }

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
    if (updatePondDto.location !== undefined) {
      pond.location = updatePondDto.location;
    }
    if (updatePondDto.capacity !== undefined) {
      pond.capacity = updatePondDto.capacity;
    }
    if (updatePondDto.farmId !== undefined) {
      if (updatePondDto.farmId === null) {
        pond.farmId = null;
      } else {
        const farm = await this.farmRepo.findOneBy({ farmId: updatePondDto.farmId });
        if (!farm) throw new NotFoundException('Không tìm thấy trại nuôi');
        if (farm.ownerId !== pond.userId) throw new BadRequestException('Ao nuôi phải thuộc cùng chủ sở hữu với trại nuôi');
        pond.farmId = farm.farmId;
      }
    }

    return this.sanitizePond(await this.pondRepo.save(pond));
  }

  async deletePond(
    pondId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<MessageOnlyResponse> {
    const pond = await this.findPondById(
      pondId,
      currentUserId,
      currentUserRole,
    );
    await this.assertPondManager(pond, currentUserId, currentUserRole);
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
    const pond = await this.findPondById(pondId, currentUserId, currentUserRole);
    await this.assertPondManager(pond, currentUserId, currentUserRole);

    const existingConfig = await this.thresholdRepo.findOne({
      where: { pondId, metricName: dto.metricName },
    });

    if (existingConfig) {
      throw new ConflictException(
        `Cấu hình ngưỡng cho thông số "${dto.metricName}" đã tồn tại trong ao nuôi này!`,
      );
    }

    if (dto.minValue > dto.maxValue) {
      throw new BadRequestException(
        'Giá trị tối thiểu (minValue) không được lớn hơn giá trị tối đa (maxValue)!',
      );
    }

    const config = this.thresholdRepo.create({
      ...dto,
      pondId,
    });

    const savedConfig = await this.thresholdRepo.save(config);
    await this.invalidateThresholdCache(pondId);
    return savedConfig;
  }

  async findThresholdsByPond(
    pondId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ThresholdResponse[]> {
    await this.findPondById(pondId, currentUserId, currentUserRole);
    const configs = await this.thresholdRepo.find({
      where: { pondId },
      order: { metricName: 'ASC' },
    });

    const METRIC_META: Record<string, ThresholdMetricMetadata> = {
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
      const meta = METRIC_META[c.metricName] ?? {
        unit: '',
        color: '#38bdf8',
        dangerFactor: 0.8,
      };
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

    if (currentUserRole === Role.FARMER)
      throw new ForbiddenException('FARMER không có quyền chỉnh sửa cấu hình ngưỡng!');
    await this.assertPondManager(config.pond, currentUserId, currentUserRole);

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

    const savedConfig = await this.thresholdRepo.save(config);
    await this.invalidateThresholdCache(config.pondId);
    return savedConfig;
  }

  async deleteThresholdConfig(
    configId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<MessageOnlyResponse> {
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

    if (currentUserRole === Role.FARMER)
      throw new ForbiddenException('FARMER không có quyền xóa cấu hình ngưỡng!');
    await this.assertPondManager(config.pond, currentUserId, currentUserRole);

    const pondId = config.pondId;
    await this.thresholdRepo.remove(config);
    await this.invalidateThresholdCache(pondId);
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

    return this.sanitizeManualLog(await this.manualLogRepo.save(log));
  }

  async findManualLogsByPond(
    pondId: string,
    query: FindManualTestLogsQueryDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<PaginatedResponse<ManualTestLog>> {
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
      data: data.map((log) => this.sanitizeManualLog(log)),
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

    await this.assertPondAccess(log.pond, currentUserId, currentUserRole);
    return this.sanitizeManualLog(log);
  }

  async updateManualTestLog(
    logId: string,
    dto: UpdateManualTestLogDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<ManualTestLog> {
    const log = await this.manualLogRepo.findOne({
      where: { logId },
      relations: { pond: true, testedBy: true },
    });
    if (!log) throw new NotFoundException(`Không tìm thấy bản ghi đo thủ công với ID: ${logId}`);
    await this.assertManualLogManager(log.pond, currentUserId, currentUserRole);

    if (dto.nh3Value !== undefined) log.nh3Value = dto.nh3Value;
    if (dto.no2Value !== undefined) log.no2Value = dto.no2Value;
    if (dto.note !== undefined) log.note = dto.note;
    if (dto.testedAt !== undefined) log.testedAt = new Date(dto.testedAt);

    return this.sanitizeManualLog(await this.manualLogRepo.save(log));
  }

  async deleteManualTestLog(
    logId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<MessageOnlyResponse> {
    const log = await this.manualLogRepo.findOne({
      where: { logId },
      relations: { pond: true, testedBy: true },
    });
    if (!log) throw new NotFoundException(`Không tìm thấy bản ghi đo thủ công với ID: ${logId}`);
    await this.assertManualLogManager(log.pond, currentUserId, currentUserRole);
    await this.manualLogRepo.remove(log);
    return { message: 'Xóa bản ghi đo thủ công thành công!' };
  }

  async assignFarmer(
    pondId: string,
    farmerId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<PondFarmerAssignment> {
    if (currentUserRole !== Role.ADMIN && currentUserRole !== Role.MANAGER)
      throw new ForbiddenException('Chỉ ADMIN hoặc MANAGER mới có quyền phân công FARMER');
    const pond = await this.findPondById(pondId, currentUserId, currentUserRole);
    await this.assertPondManager(pond, currentUserId, currentUserRole);
    if (!this.userRepo || !this.assignmentRepo)
      throw new ForbiddenException('Dịch vụ phân công FARMER chưa sẵn sàng');
    const farmer = await this.userRepo.findOneBy({ userId: farmerId });
    if (!farmer) throw new NotFoundException('Không tìm thấy FARMER');
    if (farmer.role !== Role.FARMER)
      throw new BadRequestException('Chỉ có thể phân công người dùng có vai trò FARMER');
    if (await this.assignmentRepo.exist({ where: { pondId, farmerId } }))
      throw new ConflictException('FARMER đã được phân công cho ao nuôi này');
    return this.assignmentRepo.save(this.assignmentRepo.create({ pondId, farmerId }));
  }

  async revokeFarmer(
    pondId: string,
    farmerId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<MessageOnlyResponse> {
    if (currentUserRole !== Role.ADMIN && currentUserRole !== Role.MANAGER)
      throw new ForbiddenException('Chỉ ADMIN hoặc MANAGER mới có quyền thu hồi phân công FARMER');
    const pond = await this.findPondById(pondId, currentUserId, currentUserRole);
    await this.assertPondManager(pond, currentUserId, currentUserRole);
    if (!this.assignmentRepo)
      throw new ForbiddenException('Dịch vụ phân công FARMER chưa sẵn sàng');
    const assignment = await this.assignmentRepo.findOneBy({ pondId, farmerId });
    if (!assignment) throw new NotFoundException('Không tìm thấy phân công FARMER cho ao nuôi này');
    await this.assignmentRepo.remove(assignment);
    return { message: 'Thu hồi phân công FARMER thành công!' };
  }
}
