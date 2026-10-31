import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { PondFarmerAssignment } from '../ponds/entities/pond-farmer-assignment.entity.js';
import {
  CreateCropDto,
  CreateHarvestDto,
  FindCropsQueryDto,
  UpdateCropDto,
} from './dto/crop.dto.js';
import { HarvestLog } from './entities/harvest-log.entity.js';
import { ShrimpBatch } from './entities/shrimp-batch.entity.js';
import { ShrimpBatchStatus } from '../../common/enums/shrimp-batch-status.enum.js';

@Injectable()
export class CropsService {
  constructor(
    @InjectRepository(ShrimpBatch)
    private readonly batches: Repository<ShrimpBatch>,
    @InjectRepository(HarvestLog)
    private readonly harvests: Repository<HarvestLog>,
    @InjectRepository(Pond) private readonly ponds: Repository<Pond>,
    @InjectRepository(PondFarmerAssignment)
    private readonly assignments?: Repository<PondFarmerAssignment>,
  ) {}
  private async assertPondAccess(pond: Pond, userId: string, role: Role): Promise<void> {
    if (role === Role.ADMIN) return;
    if (role === Role.MANAGER) {
      if (pond.userId !== userId && this.assignments) throw new ForbiddenException('Bạn không có quyền quản lý ao nuôi này!');
      return;
    }
    if (!(this.assignments
      ? await this.assignments.exist({ where: { pondId: pond.pondId, farmerId: userId } })
      : pond.userId === userId))
      throw new ForbiddenException('Bạn không được phân công cho ao nuôi này!');
  }
  private async assertPondManager(pond: Pond, userId: string, role: Role): Promise<void> {
    if (this.assignments && role !== Role.ADMIN && (role !== Role.MANAGER || pond.userId !== userId))
      throw new ForbiddenException('Chỉ MANAGER sở hữu ao mới có quyền quản lý vụ nuôi!');
  }
  private async pondForUser(
    pondId: string,
    userId: string,
    role: Role,
  ): Promise<Pond> {
    const pond = await this.ponds.findOneBy({ pondId });
    if (!pond) throw new NotFoundException('Không tìm thấy ao nuôi');
    await this.assertPondAccess(pond, userId, role);
    return pond;
  }
  private validateDates(stockingDate: string, expected?: string | null): void {
    if (expected && expected < stockingDate)
      throw new BadRequestException(
        'Ngày dự kiến thu hoạch không được trước ngày thả giống',
      );
  }
  private async batchForUser(
    batchId: string,
    userId: string,
    role: Role,
  ): Promise<ShrimpBatch> {
    const batch = await this.batches.findOne({
      where: { batchId },
      relations: { pond: true },
    });
    if (!batch) throw new NotFoundException('Không tìm thấy vụ nuôi');
    await this.assertPondAccess(batch.pond, userId, role);
    return batch;
  }
  async create(
    dto: CreateCropDto,
    userId: string,
    role: Role,
  ): Promise<ShrimpBatch> {
    const pond = await this.pondForUser(dto.pondId, userId, role);
    await this.assertPondManager(pond, userId, role);
    this.validateDates(dto.stockingDate, dto.expectedHarvestDate);
    if (
      await this.batches.exist({
        where: { pondId: dto.pondId, status: ShrimpBatchStatus.ACTIVE },
      })
    )
      throw new ConflictException('Ao nuôi đã có vụ nuôi đang hoạt động');
    try {
      return await this.batches.save(
        this.batches.create({
          ...dto,
          initialQuantity: dto.initialQuantity.toString(),
          expectedHarvestDate: dto.expectedHarvestDate ?? null,
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof QueryFailedError &&
        String(error.driverError?.code) === '23505'
      )
        throw new ConflictException('Ao nuôi đã có vụ nuôi đang hoạt động');
      throw error;
    }
  }
  async findAll(query: FindCropsQueryDto, userId: string, role: Role) {
    const { page = 1, limit = 10, pondId, farmId, status } = query;
    const qb = this.batches
      .createQueryBuilder('batch')
      .innerJoinAndSelect('batch.pond', 'pond')
      .where('1=1');
    if (role === Role.MANAGER) qb.andWhere('pond.user_id = :userId', { userId });
    if (role === Role.FARMER) qb.innerJoin('pond_farmer_assignments', 'assignment', 'assignment.pond_id = pond.pond_id AND assignment.farmer_id = :userId', { userId });
    if (pondId) qb.andWhere('batch.pond_id = :pondId', { pondId });
    if (farmId) qb.andWhere('pond.farm_id = :farmId', { farmId });
    if (status) qb.andWhere('batch.status = :status', { status });
    const [data, total] = await qb
      .orderBy('batch.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
  async findOne(id: string, userId: string, role: Role): Promise<ShrimpBatch> {
    return this.batchForUser(id, userId, role);
  }
  async update(
    id: string,
    dto: UpdateCropDto,
    userId: string,
    role: Role,
  ): Promise<ShrimpBatch> {
    const batch = await this.batchForUser(id, userId, role);
    await this.assertPondManager(batch.pond, userId, role);
    if (batch.status !== ShrimpBatchStatus.ACTIVE)
      throw new ConflictException('Chỉ có thể cập nhật vụ nuôi đang hoạt động');
    if (dto.pondId && dto.pondId !== batch.pondId)
      throw new BadRequestException('Không hỗ trợ chuyển vụ nuôi sang ao khác');
    const stockingDate = dto.stockingDate ?? batch.stockingDate;
    this.validateDates(
      stockingDate,
      dto.expectedHarvestDate ?? batch.expectedHarvestDate,
    );
    Object.assign(batch, {
      ...dto,
      pondId: batch.pondId,
      initialQuantity: dto.initialQuantity?.toString() ?? batch.initialQuantity,
      expectedHarvestDate: dto.expectedHarvestDate ?? batch.expectedHarvestDate,
    });
    return this.batches.save(batch);
  }
  async changeStatus(
    id: string,
    target: ShrimpBatchStatus,
    userId: string,
    role: Role,
  ): Promise<ShrimpBatch> {
    const batch = await this.batchForUser(id, userId, role);
    await this.assertPondManager(batch.pond, userId, role);
    if (batch.status !== ShrimpBatchStatus.ACTIVE)
      throw new ConflictException(
        'Không thể chuyển trạng thái của vụ nuôi đã đóng',
      );
    if (target === ShrimpBatchStatus.ACTIVE)
      throw new BadRequestException('Vụ nuôi đã ở trạng thái ACTIVE');
    batch.status = target;
    return this.batches.save(batch);
  }
  async remove(
    id: string,
    userId: string,
    role: Role,
  ): Promise<{ message: string }> {
    const batch = await this.batchForUser(id, userId, role);
    await this.assertPondManager(batch.pond, userId, role);
    if (await this.harvests.exist({ where: { batchId: id } }))
      throw new ConflictException(
        'Không thể xóa vụ nuôi đã có nhật ký thu hoạch',
      );
    await this.batches.remove(batch);
    return { message: 'Xóa vụ nuôi thành công!' };
  }
  async density(id: string, userId: string, role: Role) {
    const batch = await this.batchForUser(id, userId, role);
    const area = Number(batch.pond.areaM2);
    if (!Number.isFinite(area) || area <= 0)
      throw new BadRequestException('Diện tích ao không hợp lệ để tính mật độ');
    return {
      initialDensity: Number(batch.initialQuantity) / area,
      currentEstimatedDensity: null,
      unit: 'con/m²',
      pondAreaM2: area,
      calculatedAt: new Date(),
      currentEstimateNote:
        'Chưa có dữ liệu mortality hoặc điều chỉnh đàn để ước tính mật độ hiện tại.',
    };
  }
  async createHarvest(
    batchId: string,
    dto: CreateHarvestDto,
    userId: string,
    role: Role,
  ): Promise<HarvestLog> {
    const batch = await this.batchForUser(batchId, userId, role);
    if (batch.status !== ShrimpBatchStatus.ACTIVE)
      throw new ConflictException(
        'Chỉ được ghi nhận thu hoạch cho vụ nuôi đang hoạt động',
      );
    if (dto.harvestDate < batch.stockingDate)
      throw new BadRequestException(
        'Ngày thu hoạch không được trước ngày thả giống',
      );
    return this.harvests.save(
      this.harvests.create({
        ...dto,
        batchId,
        harvestQuantity: dto.harvestQuantity?.toString() ?? null,
        harvestWeightKg: dto.harvestWeightKg.toString(),
        note: dto.note ?? null,
      }),
    );
  }
  async listHarvests(
    batchId: string,
    userId: string,
    role: Role,
  ): Promise<HarvestLog[]> {
    await this.batchForUser(batchId, userId, role);
    return this.harvests.find({
      where: { batchId },
      order: { harvestDate: 'DESC', createdAt: 'DESC' },
    });
  }
  async harvestSummary(batchId: string, userId: string, role: Role) {
    await this.batchForUser(batchId, userId, role);
    const result = await this.harvests
      .createQueryBuilder('harvest')
      .select('COALESCE(SUM(harvest.harvest_weight_kg), 0)', 'totalWeightKg')
      .addSelect('COUNT(*)', 'harvestCount')
      .where('harvest.batch_id = :batchId', { batchId })
      .getRawOne<{ totalWeightKg: string; harvestCount: string }>();
    return {
      batchId,
      totalWeightKg: Number(result?.totalWeightKg ?? 0),
      harvestCount: Number(result?.harvestCount ?? 0),
    };
  }
  async findByPond(pondId: string, userId: string, role: Role) {
    await this.pondForUser(pondId, userId, role);
    return this.batches.find({
      where: { pondId },
      order: { stockingDate: 'DESC' },
    });
  }
}
