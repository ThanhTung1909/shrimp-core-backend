import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { Device } from './entities/device.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { FindDevicesQueryDto } from './dto/find-devices-query.dto.js';
import { Role } from '../../common/enums/role.enum.js';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
  ) { }

  async createDevice(
    dto: CreateDeviceDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    // 1. Kiểm tra xem địa chỉ MAC đã tồn tại chưa
    const existingDevice = await this.deviceRepo.findOne({
      where: { macAddress: dto.macAddress },
    });
    if (existingDevice) {
      throw new ConflictException(
        `Địa chỉ MAC ${dto.macAddress} đã được đăng ký cho thiết bị khác!`,
      );
    }

    // 2. Kiểm tra quyền truy cập vào ao nuôi
    const pond = await this.pondRepo.findOne({
      where: { pondId: dto.pondId },
    });
    if (!pond) {
      throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${dto.pondId}`);
    }

    if (currentUserRole === Role.FARMER && pond.userId !== currentUserId) {
      throw new ForbiddenException('Bạn không có quyền gắn thiết bị vào ao này!');
    }

    const device = this.deviceRepo.create(dto);
    return await this.deviceRepo.save(device);
  }

  async findAllDevices(
    query: FindDevicesQueryDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{
    data: Device[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 10, search, pondId, status } = query;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<Device>[] | FindOptionsWhere<Device> = {};

    const baseFilter: FindOptionsWhere<Device> = {
      ...(pondId ? { pondId } : {}),
      ...(status ? { status } : {}),
      ...(currentUserRole === Role.FARMER
        ? { pond: { userId: currentUserId } }
        : {}),
    };

    if (search) {
      where = [
        {
          ...baseFilter,
          deviceName: ILike(`%${search}%`),
        },
        {
          ...baseFilter,
          macAddress: ILike(`%${search}%`),
        },
      ];
    } else {
      where = baseFilter;
    }

    const [data, total] = await this.deviceRepo.findAndCount({
      where,
      relations: {
        pond: true,
      },
      order: { deviceName: 'ASC' },
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

  async findDeviceById(
    deviceId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    const device = await this.deviceRepo.findOne({
      where: { deviceId },
      relations: {
        pond: true,
      },
    });

    if (!device) {
      throw new NotFoundException(`Không tìm thấy thiết bị với ID: ${deviceId}`);
    }

    if (currentUserRole === Role.FARMER && device.pond?.userId !== currentUserId) {
      throw new ForbiddenException('Bạn không có quyền truy cập thiết bị này!');
    }

    return device;
  }

  async updateDevice(
    deviceId: string,
    dto: UpdateDeviceDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );

    // Kiểm tra MAC mới nếu có thay đổi
    if (dto.macAddress && dto.macAddress !== device.macAddress) {
      const existing = await this.deviceRepo.findOne({
        where: { macAddress: dto.macAddress },
      });
      if (existing && existing.deviceId !== deviceId) {
        throw new ConflictException(
          `Địa chỉ MAC ${dto.macAddress} đã thuộc về thiết bị khác!`,
        );
      }
      device.macAddress = dto.macAddress;
    }

    // Kiểm tra ao nuôi mới nếu có chuyển ao
    if (dto.pondId && dto.pondId !== device.pondId) {
      const newPond = await this.pondRepo.findOne({
        where: { pondId: dto.pondId },
      });
      if (!newPond) {
        throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${dto.pondId}`);
      }
      if (currentUserRole === Role.FARMER && newPond.userId !== currentUserId) {
        throw new ForbiddenException(
          'Bạn không có quyền chuyển thiết bị sang ao nuôi này!',
        );
      }
      device.pondId = dto.pondId;
    }

    if (dto.deviceName !== undefined) device.deviceName = dto.deviceName;
    if (dto.firmwareVersion !== undefined)
      device.firmwareVersion = dto.firmwareVersion;
    if (dto.status !== undefined) device.status = dto.status;
    if (dto.lastActiveAt !== undefined)
      device.lastActiveAt = new Date(dto.lastActiveAt);

    return await this.deviceRepo.save(device);
  }

  async deleteDevice(
    deviceId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{ message: string }> {
    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );
    await this.deviceRepo.remove(device);
    return { message: 'Xóa thiết bị thành công!' };
  }
}
