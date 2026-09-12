import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  type Relation,
} from 'typeorm';
import { Role } from '../../../common/enums/role.enum.js';
import { Pond } from '../../ponds/entities/pond.entity.js';
import { Alert } from '../../alerts/entities/alert.entity.js';
import { ManualTestLog } from '../../ponds/entities/manual-test-log.entity.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ name: 'full_name', type: 'varchar', length: 100 })
  fullName: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 20, unique: true })
  phoneNumber: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: Role,
    enumName: 'role',
    default: Role.FARMER,
  })
  role: Role;

  @Column({ name: 'fcm_token', type: 'varchar', length: 255, nullable: true })
  fcmToken: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // version của token, mục đích là vô hiệu hóa các token cũ
  @Column({
    name: 'token_version',
    type: 'int',
    default: 0,
  })
  tokenVersion: number;

  @OneToMany(() => Pond, (pond) => pond.user)
  ponds: Relation<Pond>[];

  @OneToMany(() => Alert, (alert) => alert.resolvedBy)
  resolvedAlerts: Relation<Alert>[];

  @OneToMany(() => ManualTestLog, (log) => log.testedBy)
  testedLogs: Relation<ManualTestLog>[];
}


