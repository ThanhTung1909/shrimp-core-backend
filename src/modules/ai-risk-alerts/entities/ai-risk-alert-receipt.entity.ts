import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { Alert } from '../../alerts/entities/alert.entity.js';

/** Durable inbox record: RabbitMQ delivers at least once; effects are idempotent by event ID. */
@Entity('ai_risk_alert_receipt')
@Index('uq_ai_risk_alert_receipt_event_id', ['eventId'], { unique: true })
export class AiRiskAlertReceipt {
  @PrimaryGeneratedColumn('uuid', { name: 'receipt_id' })
  receiptId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'outcome', type: 'varchar', length: 20 })
  outcome: 'CREATED' | 'IGNORED_LOW';

  @Column({ name: 'alert_id', type: 'uuid', nullable: true })
  alertId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Alert, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'alert_id' })
  alert: Relation<Alert> | null;
}
