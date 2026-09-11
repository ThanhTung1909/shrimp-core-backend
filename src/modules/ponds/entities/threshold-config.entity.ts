import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Check,
  type Relation,
} from 'typeorm';
import { Pond } from './pond.entity.js';

@Entity('threshold_config')
@Check(`"min_value" <= "max_value"`)
export class ThresholdConfig {
  @PrimaryGeneratedColumn('uuid', { name: 'config_id' })
  configId: string;

  @Column({ type: 'uuid', name: 'pond_id' })
  pondId: string;

  @Column({ name: 'metric_name', type: 'varchar', length: 50 })
  metricName: string;

  @Column({ name: 'min_value', type: 'double precision' })
  minValue: number;

  @Column({ name: 'max_value', type: 'double precision' })
  maxValue: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @ManyToOne(() => Pond, (pond) => pond.thresholdConfigs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;
}

