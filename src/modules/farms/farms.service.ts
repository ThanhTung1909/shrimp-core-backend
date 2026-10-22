import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { CreateFarmDto, FindFarmsQueryDto, UpdateFarmDto } from './dto/farm.dto.js';
import { Farm } from './entities/farm.entity.js';

@Injectable()
export class FarmsService {
  constructor(@InjectRepository(Farm) private readonly farms: Repository<Farm>, @InjectRepository(Pond) private readonly ponds: Repository<Pond>) {}
  private authorize(farm: Farm, userId: string, role: Role): void { if (role !== Role.ADMIN && farm.ownerId !== userId) throw new ForbiddenException('Bạn không có quyền truy cập trại nuôi này!'); }
  async create(dto: CreateFarmDto, userId: string): Promise<Farm> { return this.farms.save(this.farms.create({ ...dto, ownerId: userId, totalArea: dto.totalArea?.toString() })); }
  async findAll(query: FindFarmsQueryDto, userId: string, role: Role) {
    const { page = 1, limit = 10, search } = query;
    const where = { ...(role === Role.ADMIN ? {} : { ownerId: userId }), ...(search ? { farmName: ILike(`%${search}%`) } : {}) };
    const [data, total] = await this.farms.findAndCount({ where, relations: { owner: true }, order: { createdAt: 'DESC' }, skip: (page - 1) * limit, take: limit });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
  async findOne(farmId: string, userId: string, role: Role): Promise<Farm> { const farm = await this.farms.findOne({ where: { farmId }, relations: { owner: true, ponds: true } }); if (!farm) throw new NotFoundException('Không tìm thấy trại nuôi'); this.authorize(farm, userId, role); return farm; }
  async update(farmId: string, dto: UpdateFarmDto, userId: string, role: Role): Promise<Farm> { const farm = await this.findOne(farmId, userId, role); Object.assign(farm, { ...dto, ...(dto.totalArea !== undefined ? { totalArea: dto.totalArea.toString() } : {}) }); return this.farms.save(farm); }
  async remove(farmId: string, userId: string, role: Role): Promise<{ message: string }> { const farm = await this.findOne(farmId, userId, role); if (await this.ponds.exist({ where: { farmId } })) throw new ConflictException('Không thể xóa trại đang chứa ao nuôi. Hãy chuyển hoặc xóa ao trước.'); await this.farms.remove(farm); return { message: 'Xóa trại nuôi thành công!' }; }
  async findPonds(farmId: string, userId: string, role: Role): Promise<Pond[]> { await this.findOne(farmId, userId, role); return this.ponds.find({ where: { farmId }, order: { createdAt: 'DESC' } }); }
}
