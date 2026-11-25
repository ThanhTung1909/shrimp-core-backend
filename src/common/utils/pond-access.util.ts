import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Role } from '../enums/role.enum.js';
import { Farm } from '../../modules/farms/entities/farm.entity.js';
import { Pond } from '../../modules/ponds/entities/pond.entity.js';
import { PondFarmerAssignment } from '../../modules/ponds/entities/pond-farmer-assignment.entity.js';

export interface PondAccessDeps {
  farmRepo?: Pick<Repository<Farm>, 'findOneBy'>;
  assignmentRepo?: Pick<Repository<PondFarmerAssignment>, 'exist'>;
}

export async function assertPondAccess(
  pond: Pond,
  currentUserId: string,
  currentUserRole: Role,
  deps?: PondAccessDeps,
): Promise<void> {
  if (currentUserRole === Role.ADMIN) return;

  if (currentUserRole === Role.MANAGER) {
    if (!deps?.farmRepo) {
      if (deps?.assignmentRepo && pond.userId !== currentUserId) {
        throw new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!');
      }
      return;
    }
    if (pond.userId === currentUserId) return;
    if (pond.farmId) {
      const farm = await deps.farmRepo.findOneBy({ farmId: pond.farmId });
      if (farm && farm.ownerId === currentUserId) return;
    }
    throw new ForbiddenException('Bạn không có quyền truy cập ao nuôi này!');
  }

  const isAssignedFarmer =
    currentUserRole === Role.FARMER &&
    (deps?.assignmentRepo
      ? await deps.assignmentRepo.exist({
          where: { pondId: pond.pondId, farmerId: currentUserId },
        })
      : pond.userId === currentUserId);

  if (!isAssignedFarmer) {
    throw new ForbiddenException('Bạn không được phân công cho ao nuôi này!');
  }
}

export async function assertPondManager(
  pond: Pond,
  currentUserId: string,
  currentUserRole: Role,
  deps?: PondAccessDeps,
  managerForbiddenMessage = 'Chỉ ADMIN hoặc MANAGER mới có quyền quản lý ao nuôi này!',
): Promise<void> {
  if (currentUserRole === Role.ADMIN) return;

  if (!deps?.farmRepo) {
    if (deps?.assignmentRepo) {
      if (currentUserRole !== Role.MANAGER || pond.userId !== currentUserId) {
        throw new ForbiddenException(managerForbiddenMessage);
      }
      return;
    }
    if (currentUserRole === Role.MANAGER || pond.userId === currentUserId) {
      return;
    }
    throw new ForbiddenException(managerForbiddenMessage);
  }

  if (currentUserRole === Role.MANAGER) {
    if (pond.farmId) {
      const farm = await deps.farmRepo.findOneBy({ farmId: pond.farmId });
      if (farm && farm.ownerId === currentUserId) return;
    }
    throw new ForbiddenException(
      'Quản lý chỉ có quyền quản lý các ao nuôi trong các trang trại do mình quản lý!',
    );
  }

  throw new ForbiddenException(managerForbiddenMessage);
}
