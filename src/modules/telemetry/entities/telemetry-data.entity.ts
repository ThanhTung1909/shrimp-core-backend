import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { Device } from '../../devices/entities/device.entity.js';

@Entity('telemetry_data')
@Index('idx_telemetry_device_time', ['deviceId', 'recordedAt'])
@Index('telemetry_data_recorded_at_idx', ['recordedAt'])
export class TelemetryData {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @PrimaryColumn({
    type: 'timestamp with time zone',
    name: 'recorded_at',
    default: () => 'now()',
  })
  recordedAt: Date;

  @Column({ type: 'uuid', name: 'device_id' })
  deviceId: string;

  @Column({ type: 'double precision', nullable: true })
  temperature: number | null;

  @Column({ type: 'double precision', nullable: true })
  ph: number | null;

  @Column({ type: 'double precision', nullable: true })
  salinity: number | null;

  @Column({ type: 'double precision', nullable: true, name: 'dissolved_oxygen' })
  dissolvedOxygen: number | null;

  @Column({ type: 'double precision', nullable: true })
  turbidity: number | null;

  @Column({ type: 'double precision', nullable: true, name: 'water_level' })
  waterLevel: number | null;

  @Column({ type: 'boolean', default: false, name: 'is_buffered' })
  isBuffered: boolean;

  @ManyToOne(() => Device, (device) => device.telemetries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'device_id' })
  device: Relation<Device>;
}


