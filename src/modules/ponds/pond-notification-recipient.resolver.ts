import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pond } from './entities/pond.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Role } from '../../common/enums/role.enum.js';

@Injectable()
export class PondNotificationRecipientResolver {
  constructor(@InjectRepository(Pond) private readonly ponds: Repository<Pond>) {}

  async resolve(pondId: string, recipientId?: string): Promise<{ pond: Pond; recipients: User[] } | null> {
    const pond = await this.ponds.createQueryBuilder('pond')
      .leftJoinAndSelect('pond.farm', 'farm')
      .leftJoinAndSelect('farm.owner', 'owner')
      .leftJoinAndSelect('pond.farmerAssignments', 'assignment', recipientId ? 'assignment.farmer_id = :recipientId' : '1=1', { recipientId })
      .leftJoinAndSelect('assignment.farmer', 'farmer')
      .select(['pond.pondId', 'pond.pondName', 'farm.farmId', 'owner.userId', 'owner.role', 'owner.isActive', 'owner.fullName', 'owner.phoneNumber', 'owner.email', 'assignment.assignmentId', 'farmer.userId', 'farmer.role', 'farmer.isActive', 'farmer.fullName', 'farmer.phoneNumber', 'farmer.email'])
      .where('pond.pondId = :pondId', { pondId })
      .getOne();
    if (!pond) return null;
    const users = new Map<string, User>();
    const owner = pond.farm?.owner;
    if (owner?.isActive && owner.role === Role.MANAGER && (!recipientId || owner.userId === recipientId)) users.set(owner.userId, owner);
    for (const assignment of pond.farmerAssignments ?? []) {
      const farmer = assignment.farmer;
      if (farmer?.isActive && farmer.role === Role.FARMER && (!recipientId || farmer.userId === recipientId)) users.set(farmer.userId, farmer);
    }
    return { pond, recipients: [...users.values()] };
  }
}
