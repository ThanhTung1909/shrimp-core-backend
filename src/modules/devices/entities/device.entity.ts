import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  type Relation,
} from 'typeorm';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';
import { Pond } from '../../ponds/entities/pond.entity.js';
import { TelemetryData } from '../../telemetry/entities/telemetry-data.entity.js';

@Entity('device')
@Index(['status', 'lastActiveAt'])
export class Device {
  @PrimaryGeneratedColumn('uuid', { name: 'device_id' })
  deviceId: string;

  @Column({ type: 'uuid', name: 'pond_id' })
  pondId: string;

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

  @ManyToOne(() => Pond, (pond) => pond.devices, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;

  @OneToMany(() => TelemetryData, (telemetry) => telemetry.device)
  telemetries: Relation<TelemetryData>[];
}

