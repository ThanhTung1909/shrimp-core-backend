import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './entities/device.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { Farm } from '../farms/entities/farm.entity.js';
import { PondFarmerAssignment } from '../ponds/entities/pond-farmer-assignment.entity.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { AssignPondDto } from './dto/assign-pond.dto.js';
import { UpdateDeviceStatusDto } from './dto/update-device-status.dto.js';
import { ReportDeviceFaultDto } from './dto/report-device-fault.dto.js';
import { FindDevicesQueryDto } from './dto/find-devices-query.dto.js';
import { Role } from '../../common/enums/role.enum.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';

export interface PaginatedDevicesResult {
  data: Device[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Pond)
    private readonly pondRepo: Repository<Pond>,
    @InjectRepository(Farm)
    private readonly farmRepo: Repository<Farm>,
    @InjectRepository(PondFarmerAssignment)
    private readonly assignmentRepo: Repository<PondFarmerAssignment>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
  ) {}

  /**
   * Đăng ký thiết bị IoT mới
   * - ADMIN: toàn quyền đăng ký thiết bị (có thể gắn hoặc chưa gắn vào ao)
   * - MANAGER: chỉ được tạo thiết bị thuộc các ao nuôi trong các trang trại do mình quản lý
   * - FARMER: không được phép tạo thiết bị
   */
  async createDevice(
    dto: CreateDeviceDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    if (currentUserRole === Role.FARMER) {
      throw new ForbiddenException(
        'Nông dân chỉ có quyền xem dữ liệu thiết bị và báo cáo thiết bị hỏng!',
      );
    }

    // 1. Kiểm tra địa chỉ MAC đã tồn tại chưa
    const existingDevice = await this.deviceRepo.findOne({
      where: { macAddress: dto.macAddress.trim() },
    });
    if (existingDevice) {
      throw new ConflictException(
        `Địa chỉ MAC ${dto.macAddress} đã được đăng ký cho thiết bị khác!`,
      );
    }

    // 2. Kiểm tra quyền gắn thiết bị vào ao nuôi
    if (currentUserRole === Role.MANAGER) {
      if (!dto.pondId) {
        throw new ForbiddenException(
          'Quản lý chỉ được đăng ký thiết bị gắn với các ao nuôi trong các trang trại do mình quản lý!',
        );
      }
      const pond = await this.pondRepo.findOne({
        where: { pondId: dto.pondId },
        relations: { farm: true },
      });
      if (!pond) {
        throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${dto.pondId}`);
      }
      let isManagerFarm =
        (pond.farm && pond.farm.ownerId === currentUserId) ||
        pond.userId === currentUserId;
      if (!isManagerFarm && pond.farmId) {
        const farm = await this.farmRepo.findOneBy({ farmId: pond.farmId });
        if (farm && farm.ownerId === currentUserId) {
          isManagerFarm = true;
        }
      }
      if (!isManagerFarm) {
        throw new ForbiddenException(
          'Quản lý chỉ được tạo thiết bị thuộc các ao nuôi trong các trang trại do mình quản lý!',
        );
      }
    } else if (dto.pondId) {
      const pond = await this.pondRepo.findOne({
        where: { pondId: dto.pondId },
      });
      if (!pond) {
        throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${dto.pondId}`);
      }
    }

    const device = this.deviceRepo.create({
      ...dto,
      macAddress: dto.macAddress.trim(),
      deviceName: dto.deviceName.trim(),
      pondId: dto.pondId || null,
    });
    return await this.deviceRepo.save(device);
  }

  /**
   * Lấy danh sách thiết bị IoT (phân trang & lọc)
   * - ADMIN: toàn quyền xem tất cả thiết bị hệ thống
   * - MANAGER: chỉ xem các thiết bị thuộc các ao nuôi trong các trang trại do mình quản lý
   * - FARMER: chỉ xem các thiết bị thuộc các ao nuôi được phân công cho mình
   */
  async findAllDevices(
    query: FindDevicesQueryDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<PaginatedDevicesResult> {
    const { page = 1, limit = 10, search, pondId, status } = query;
    const skip = (page - 1) * limit;

    const qb = this.deviceRepo.createQueryBuilder('device');
    qb.leftJoinAndSelect('device.pond', 'pond');
    qb.leftJoinAndSelect('pond.farm', 'farm');

    if (currentUserRole === Role.FARMER) {
      qb.innerJoin('device.pond', 'farmerPond');
      qb.andWhere(
        '(farmerPond.user_id = :currentUserId OR EXISTS (SELECT 1 FROM pond_farmer_assignments pfa WHERE pfa.pond_id = farmerPond.pond_id AND pfa.farmer_id = :currentUserId))',
        { currentUserId },
      );
    } else if (currentUserRole === Role.MANAGER) {
      qb.innerJoin('device.pond', 'managerPond');
      qb.leftJoin('managerPond.farm', 'mFarm');
      qb.andWhere(
        '(mFarm.owner_id = :currentUserId OR managerPond.user_id = :currentUserId)',
        { currentUserId },
      );
    }

    if (pondId) {
      qb.andWhere('device.pondId = :pondId', { pondId });
    }

    if (status) {
      qb.andWhere('device.status = :status', { status });
    }

    if (search) {
      qb.andWhere('(device.deviceName ILIKE :search OR device.macAddress ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    qb.orderBy('device.deviceName', 'ASC');
    qb.skip(skip);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Lấy chi tiết thiết bị IoT theo UUID
   * Kiểm tra quyền truy cập theo vai trò
   */
  async findDeviceById(
    deviceId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    const device = await this.deviceRepo.findOne({
      where: { deviceId },
      relations: {
        pond: {
          farm: true,
        },
      },
    });

    if (!device) {
      throw new NotFoundException(`Không tìm thấy thiết bị với ID: ${deviceId}`);
    }

    if (currentUserRole === Role.FARMER) {
      if (!device.pondId || !device.pond) {
        throw new ForbiddenException('Bạn không có quyền truy cập thiết bị này!');
      }
      const isOwner = device.pond.userId === currentUserId;
      let isAssigned = isOwner;
      if (!isAssigned) {
        isAssigned = await this.assignmentRepo.exist({
          where: { pondId: device.pond.pondId, farmerId: currentUserId },
        });
      }
      if (!isAssigned) {
        throw new ForbiddenException('Bạn không có quyền truy cập thiết bị này!');
      }
    } else if (currentUserRole === Role.MANAGER) {
      if (!device.pondId || !device.pond) {
        throw new ForbiddenException(
          'Quản lý chỉ được quyền quản lý các thiết bị thuộc các ao nuôi trong các trang trại do mình quản lý!',
        );
      }
      let isManagerFarm =
        (device.pond.farm && device.pond.farm.ownerId === currentUserId) ||
        device.pond.userId === currentUserId;
      if (!isManagerFarm && device.pond.farmId) {
        const farm = await this.farmRepo.findOneBy({ farmId: device.pond.farmId });
        if (farm && farm.ownerId === currentUserId) {
          isManagerFarm = true;
        }
      }
      if (!isManagerFarm) {
        throw new ForbiddenException(
          'Quản lý chỉ được quyền quản lý các thiết bị thuộc các ao nuôi trong các trang trại do mình quản lý!',
        );
      }
    }

    return device;
  }

  /**
   * Cập nhật thông tin thiết bị IoT
   * - ADMIN: toàn quyền
   * - MANAGER: chỉ cập nhật thiết bị thuộc ao nuôi trong trang trại của mình
   * - FARMER: bị cấm
   */
  async updateDevice(
    deviceId: string,
    dto: UpdateDeviceDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    if (currentUserRole === Role.FARMER) {
      throw new ForbiddenException(
        'Nông dân chỉ có quyền xem dữ liệu thiết bị và báo cáo thiết bị hỏng!',
      );
    }

    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );

    // Kiểm tra MAC mới nếu có thay đổi
    if (dto.macAddress && dto.macAddress.trim() !== device.macAddress) {
      const existing = await this.deviceRepo.findOne({
        where: { macAddress: dto.macAddress.trim() },
      });
      if (existing && existing.deviceId !== deviceId) {
        throw new ConflictException(
          `Địa chỉ MAC ${dto.macAddress} đã thuộc về thiết bị khác!`,
        );
      }
      device.macAddress = dto.macAddress.trim();
    }

    // Kiểm tra ao nuôi mới nếu có chuyển ao
    if (dto.pondId && dto.pondId !== device.pondId) {
      const newPond = await this.pondRepo.findOne({
        where: { pondId: dto.pondId },
        relations: { farm: true },
      });
      if (!newPond) {
        throw new NotFoundException(`Không tìm thấy ao nuôi với ID: ${dto.pondId}`);
      }

      if (currentUserRole === Role.MANAGER) {
        let isManagerFarm =
          (newPond.farm && newPond.farm.ownerId === currentUserId) ||
          newPond.userId === currentUserId;
        if (!isManagerFarm && newPond.farmId) {
          const farm = await this.farmRepo.findOneBy({ farmId: newPond.farmId });
          if (farm && farm.ownerId === currentUserId) {
            isManagerFarm = true;
          }
        }
        if (!isManagerFarm) {
          throw new ForbiddenException(
            'Quản lý chỉ được chuyển thiết bị sang các ao nuôi trong trang trại do mình quản lý!',
          );
        }
      }
      device.pondId = dto.pondId;
    }

    if (dto.deviceName !== undefined) device.deviceName = dto.deviceName.trim();
    if (dto.firmwareVersion !== undefined)
      device.firmwareVersion = dto.firmwareVersion.trim();
    if (dto.status !== undefined) device.status = dto.status;
    if (dto.lastActiveAt !== undefined)
      device.lastActiveAt = dto.lastActiveAt ? new Date(dto.lastActiveAt) : null;

    return await this.deviceRepo.save(device);
  }

  /**
   * Gán hoặc chuyển thiết bị IoT sang ao nuôi
   * - ADMIN: toàn quyền
   * - MANAGER: chỉ gán sang các ao nuôi trong trang trại do mình quản lý
   * - FARMER: bị cấm
   */
  async assignToPond(
    deviceId: string,
    assignPondDto: AssignPondDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    if (currentUserRole === Role.FARMER) {
      throw new ForbiddenException(
        'Nông dân không có quyền gán hoặc tháo thiết bị!',
      );
    }

    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );

    if (assignPondDto.pondId) {
      const pond = await this.pondRepo.findOne({
        where: { pondId: assignPondDto.pondId },
        relations: { farm: true },
      });
      if (!pond) {
        throw new NotFoundException(
          `Không tìm thấy ao nuôi với ID: ${assignPondDto.pondId}`,
        );
      }

      if (currentUserRole === Role.MANAGER) {
        let isManagerFarm =
          (pond.farm && pond.farm.ownerId === currentUserId) ||
          pond.userId === currentUserId;
        if (!isManagerFarm && pond.farmId) {
          const farm = await this.farmRepo.findOneBy({ farmId: pond.farmId });
          if (farm && farm.ownerId === currentUserId) {
            isManagerFarm = true;
          }
        }
        if (!isManagerFarm) {
          throw new ForbiddenException(
            'Quản lý chỉ được gán thiết bị vào các ao nuôi thuộc trang trại do mình quản lý!',
          );
        }
      }
      device.pondId = assignPondDto.pondId;
    } else {
      if (currentUserRole === Role.MANAGER) {
        throw new ForbiddenException(
          'Quản lý không được gỡ thiết bị ra khỏi trang trại! Thiết bị phải gắn với ao nuôi thuộc trang trại do bạn quản lý.',
        );
      }
      device.pondId = null;
    }

    return await this.deviceRepo.save(device);
  }

  /**
   * Cập nhật trạng thái thiết bị (ONLINE, OFFLINE, MAINTENANCE)
   * - ADMIN, MANAGER: được phép
   * - FARMER: phải sử dụng chức năng Báo hỏng (reportFault)
   */
  async updateStatus(
    deviceId: string,
    updateStatusDto: UpdateDeviceStatusDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    if (currentUserRole === Role.FARMER) {
      throw new ForbiddenException(
        'Nông dân chỉ có quyền báo cáo thiết bị hỏng qua chức năng Báo hỏng!',
      );
    }

    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );
    device.status = updateStatusDto.status;
    return await this.deviceRepo.save(device);
  }

  /**
   * Báo cáo sự cố / hỏng hóc thiết bị IoT
   * - Cho phép FARMER (thuộc ao nuôi được phân công), MANAGER (trang trại của mình), ADMIN
   * - Chuyển trạng thái thiết bị sang MAINTENANCE
   * - Tự động ghi nhận một cảnh báo (Alert) để Quản lý và Quản trị viên nắm bắt xử lý
   */
  async reportFault(
    deviceId: string,
    dto: ReportDeviceFaultDto,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<Device> {
    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );

    device.status = DeviceStatus.MAINTENANCE;
    const savedDevice = await this.deviceRepo.save(device);

    if (device.pondId) {
      try {
        const reasonText = dto.reason?.trim() || 'Thiết bị gặp sự cố/hư hỏng';
        const alert = this.alertRepo.create({
          pondId: device.pondId,
          deviceId: device.deviceId,
          metricName: 'THIẾT BỊ HỎNG',
          triggeredValue: 0,
          alertLevel: AlertLevel.CRITICAL,
          status: AlertStatus.ACTIVE,
          message: `Báo cáo sự cố thiết bị [${device.deviceName}]: ${reasonText}`,
        });
        await this.alertRepo.save(alert);
      } catch (err) {
        this.logger.error('Không thể tạo cảnh báo khi báo thiết bị hỏng:', err);
      }
    }

    return savedDevice;
  }

  /**
   * Xóa thiết bị IoT
   * - ADMIN: toàn quyền
   * - MANAGER: chỉ xóa thiết bị thuộc ao nuôi trong trang trại do mình quản lý
   * - FARMER: bị cấm
   */
  async deleteDevice(
    deviceId: string,
    currentUserId: string,
    currentUserRole: Role,
  ): Promise<{ message: string }> {
    if (currentUserRole === Role.FARMER) {
      throw new ForbiddenException(
        'Nông dân không có quyền xóa thiết bị!',
      );
    }

    const device = await this.findDeviceById(
      deviceId,
      currentUserId,
      currentUserRole,
    );
    await this.deviceRepo.remove(device);
    return { message: 'Xóa thiết bị thành công!' };
  }
}
