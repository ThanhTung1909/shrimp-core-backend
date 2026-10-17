import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';
import { Pond } from '../../ponds/entities/pond.entity.js';
import { TelemetryData } from '../../telemetry/entities/telemetry-data.entity.js';
import { Alert } from '../../alerts/entities/alert.entity.js';

@Entity('device')
@Index(['status', 'lastActiveAt'])
export class Device {
  @PrimaryGeneratedColumn('uuid', { name: 'device_id' })
  deviceId: string;

  @Column({ type: 'uuid', name: 'pond_id', nullable: true })
  pondId: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 100 })
  deviceName: string;

  @Column({ name: 'mac_address', type: 'varchar', length: 50, unique: true })
  macAddress: string;

  @Column({
    name: 'firmware_version',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  firmwareVersion: string | null;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    enumName: 'device_status',
    default: DeviceStatus.OFFLINE,
  })
  status: DeviceStatus;

  @Column({
    name: 'last_active_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  lastActiveAt: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  updatedAt: Date;

  @ManyToOne(() => Pond, (pond) => pond.devices, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond> | null;

  @OneToMany(() => TelemetryData, (telemetry) => telemetry.device)
  telemetries: Relation<TelemetryData>[];

  @OneToMany(() => Alert, (alert) => alert.device)
  alerts: Relation<Alert>[];
}


