import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateFarmDto, FindFarmsQueryDto, UpdateFarmDto } from './dto/farm.dto.js';
import { Farm } from './entities/farm.entity.js';

@Injectable()
export class FarmsService {
  constructor(
    @InjectRepository(Farm) private readonly farms: Repository<Farm>,
    @InjectRepository(Pond) private readonly ponds: Repository<Pond>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private sanitizeUser(user: unknown): Record<string, unknown> | undefined {
    if (!user || typeof user !== 'object') return undefined;
    const {
      passwordHash: _passwordHash,
      fcmToken: _fcmToken,
      tokenVersion: _tokenVersion,
      isLocked: _isLocked,
      mustChangePassword: _mustChangePassword,
      ...safeUser
    } = user as Record<string, unknown>;
    return safeUser;
  }

  private sanitizePond(pond: Pond): Pond {
    const sanitizedAssignments = Array.isArray(pond.farmerAssignments)
      ? pond.farmerAssignments.map((a) => ({
          ...a,
          ...(a.farmer ? { farmer: this.sanitizeUser(a.farmer) } : {}),
        }))
      : pond.farmerAssignments;
    return {
      ...pond,
      ...(pond.user ? { user: this.sanitizeUser(pond.user) } : {}),
      ...(sanitizedAssignments ? { farmerAssignments: sanitizedAssignments } : {}),
    } as unknown as Pond;
  }

  private sanitizeFarm(farm: Farm): Farm {
    return {
      ...farm,
      ...(farm.owner ? { owner: this.sanitizeUser(farm.owner) } : {}),
      ...(Array.isArray(farm.ponds)
        ? { ponds: farm.ponds.map((p) => this.sanitizePond(p)) }
        : {}),
    } as unknown as Farm;
  }

  private authorize(farm: Farm, userId: string, role: Role): void {
    if (role !== Role.ADMIN && farm.ownerId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập trại nuôi này!');
    }
  }

  /**
   * Tạo trại nuôi mới: Chỉ ADMIN
   */
  async create(dto: CreateFarmDto, userId: string, role?: Role): Promise<Farm> {
    if (role && role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN) mới có quyền tạo trại nuôi mới!');
    }
    const ownerId = dto.ownerId || userId;
    return this.farms.save(
      this.farms.create({
        ...dto,
        ownerId,
        totalArea: dto.totalArea?.toString(),
      }),
    );
  }

  /**
   * Danh sách trại nuôi:
   * - ADMIN: Xem tất cả
   * - MANAGER: Chỉ xem các trại do mình được phân công (ownerId = userId)
   */
  async findAll(query: FindFarmsQueryDto, userId: string, role: Role) {
    const { page = 1, limit = 10, search } = query;
    const where = {
      ...(role === Role.ADMIN ? {} : { ownerId: userId }),
      ...(search ? { farmName: ILike(`%${search}%`) } : {}),
    };
    const [data, total] = await this.farms.findAndCount({
      where,
      relations: { owner: true, ponds: { farmerAssignments: { farmer: true } } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: data.map((farm) => this.sanitizeFarm(farm)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(farmId: string, userId: string, role: Role): Promise<Farm> {
    const farm = await this.farms.findOne({
      where: { farmId },
      relations: { owner: true, ponds: { farmerAssignments: { farmer: true } } },
    });
    if (!farm) throw new NotFoundException('Không tìm thấy trại nuôi');
    this.authorize(farm, userId, role);
    return this.sanitizeFarm(farm);
  }

  /**
   * Chỉnh sửa thông tin trại nuôi: Chỉ ADMIN
   */
  async update(farmId: string, dto: UpdateFarmDto, userId: string, role: Role): Promise<Farm> {
    if (role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN) mới có quyền chỉnh sửa trại nuôi!');
    }
    const farm = await this.findOne(farmId, userId, role);
    const updatedOwnerId = dto.ownerId || farm.ownerId;
    Object.assign(farm, {
      ...dto,
      ownerId: updatedOwnerId,
      ...(dto.totalArea !== undefined ? { totalArea: dto.totalArea.toString() } : {}),
    });
    const saved = await this.farms.save(farm);
    if (dto.ownerId) {
      await this.ponds.update({ farmId }, { userId: dto.ownerId });
    }
    return saved;
  }

  /**
   * Phân công Quản lý cho trại nuôi: Chỉ ADMIN
   */
  async assignManager(farmId: string, managerId: string, userId: string, role: Role): Promise<Farm> {
    if (role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN) mới có quyền phân công trại nuôi cho Quản lý!');
    }
    const manager = await this.users.findOneBy({ userId: managerId });
    if (!manager || manager.role !== Role.MANAGER) {
      throw new NotFoundException('Không tìm thấy tài khoản MANAGER hợp lệ!');
    }
    const farm = await this.findOne(farmId, userId, role);
    farm.ownerId = managerId;
    const saved = await this.farms.save(farm);
    await this.ponds.update({ farmId }, { userId: managerId });
    return saved;
  }

  /** ADMIN removes the manager assignment while retaining the farm and ponds.
   * Ponds are handed back to the acting ADMIN until another manager is assigned. */
  async revokeManager(farmId: string, userId: string, role: Role): Promise<Farm> {
    if (role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN) mới có quyền thu hồi phân công Manager!');
    }
    const farm = await this.findOne(farmId, userId, role);
    if (!farm.ownerId) {
      throw new ConflictException('Trại nuôi hiện chưa được phân công cho Manager nào!');
    }
    farm.ownerId = null;
    const saved = await this.farms.save(farm);
    await this.ponds.update({ farmId }, { userId });
    return saved;
  }

  /**
   * Xóa trại nuôi: Chỉ ADMIN
   */
  async remove(farmId: string, userId: string, role: Role): Promise<{ message: string }> {
    const farm = await this.findOne(farmId, userId, role);
    if (await this.ponds.exist({ where: { farmId } })) {
      throw new ConflictException('Không thể xóa trại đang chứa ao nuôi. Hãy chuyển hoặc xóa ao trước.');
    }
    if (role && role !== Role.ADMIN) {
      throw new ForbiddenException('Chỉ Quản trị viên (ADMIN) mới có quyền xóa trại nuôi!');
    }
    await this.farms.remove(farm);
    return { message: 'Xóa trại nuôi thành công!' };
  }

  async findPonds(farmId: string, userId: string, role: Role): Promise<Pond[]> {
    await this.findOne(farmId, userId, role);
    const ponds = await this.ponds.find({
      where: { farmId },
      relations: { farmerAssignments: { farmer: true } },
      order: { createdAt: 'DESC' },
    });
    return ponds.map((p) => this.sanitizePond(p));
  }
}
