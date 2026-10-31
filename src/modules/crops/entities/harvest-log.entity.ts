import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn, type Relation } from 'typeorm';
import { ShrimpBatch } from './shrimp-batch.entity.js';

@Entity('harvest_logs')
@Check('"harvest_weight_kg" > 0')
export class HarvestLog {
  @PrimaryGeneratedColumn('uuid', { name: 'harvest_log_id' }) harvestLogId: string;
  @Column({ name: 'batch_id', type: 'uuid' }) batchId: string;
  @Column({ name: 'harvest_date', type: 'date' }) harvestDate: string;
  @Column({ name: 'harvest_quantity', type: 'bigint', nullable: true }) harvestQuantity: string | null;
  @Column({ name: 'harvest_weight_kg', type: 'numeric', precision: 14, scale: 3 }) harvestWeightKg: string;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @ManyToOne(() => ShrimpBatch, (batch) => batch.harvestLogs, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'batch_id' }) batch: Relation<ShrimpBatch>;
}
