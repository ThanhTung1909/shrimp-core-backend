import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { PondStatus } from '../../../common/enums/pond-status.enum.js';
import { User } from '../../users/entities/user.entity.js';
import { Device } from '../../devices/entities/device.entity.js';
import { ThresholdConfig } from './threshold-config.entity.js';
import { Alert } from '../../alerts/entities/alert.entity.js';
import { AiPrediction } from '../../predictions/entities/ai-prediction.entity.js';
import { ManualTestLog } from './manual-test-log.entity.js';

@Entity('pond')
export class Pond {
  @PrimaryGeneratedColumn('uuid', { name: 'pond_id' })
  pondId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ name: 'pond_name', type: 'varchar', length: 100 })
  pondName: string;

  @Column({ name: 'area_m2', type: 'double precision' })
  areaM2: number;

  @Column({ name: 'depth_m', type: 'double precision' })
  depthM: number;

  @Column({ name: 'shrimp_density', type: 'int' })
  shrimpDensity: number;

  @Column({
    type: 'enum',
    enum: PondStatus,
    enumName: 'pondstatus',
    default: PondStatus.EMPTY,
  })
  status: PondStatus;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.ponds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @OneToMany(() => Device, (device) => device.pond)
  devices: Relation<Device>[];

  @OneToMany(() => ThresholdConfig, (config) => config.pond)
  thresholdConfigs: Relation<ThresholdConfig>[];

  @OneToMany(() => Alert, (alert) => alert.pond)
  alerts: Relation<Alert>[];

  @OneToMany(() => AiPrediction, (pred) => pred.pond)
  predictions: Relation<AiPrediction>[];

  @OneToMany(() => ManualTestLog, (log) => log.pond)
  manualLogs: Relation<ManualTestLog>[];
}


