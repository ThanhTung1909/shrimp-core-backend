import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, type Relation } from 'typeorm';
import { Pond } from '../../ponds/entities/pond.entity.js';
import { ShrimpBatchStatus } from '../../../common/enums/shrimp-batch-status.enum.js';
import { HarvestLog } from './harvest-log.entity.js';

@Entity('shrimp_batches')
@Check('"initial_quantity" > 0')
export class ShrimpBatch {
  @PrimaryGeneratedColumn('uuid', { name: 'batch_id' }) batchId: string;
  @Column({ name: 'pond_id', type: 'uuid' }) pondId: string;
  @Column({ name: 'stocking_date', type: 'date' }) stockingDate: string;
  @Column({ name: 'initial_quantity', type: 'bigint' }) initialQuantity: string;
  @Column({ name: 'shrimp_species', type: 'varchar', length: 100 }) shrimpSpecies: string;
  @Column({ name: 'expected_harvest_date', type: 'date', nullable: true }) expectedHarvestDate: string | null;
  @Column({ type: 'enum', enum: ShrimpBatchStatus, enumName: 'shrimpbatchstatus', default: ShrimpBatchStatus.ACTIVE }) status: ShrimpBatchStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @ManyToOne(() => Pond, (pond) => pond.shrimpBatches, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'pond_id' }) pond: Relation<Pond>;
  @OneToMany(() => HarvestLog, (log) => log.batch) harvestLogs: Relation<HarvestLog>[];
}
