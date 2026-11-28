import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn, type Relation } from 'typeorm';
import { Alert } from '../../alerts/entities/alert.entity.js';

export type AiRiskNotificationOutboxStatus = 'PENDING' | 'PROCESSING' | 'DISPATCHED';

/**
 * A durable notification intent written in the same transaction as an AI-risk
 * alert. Redis Pub/Sub remains useful for realtime fan-out, but is not the
 * source of truth for notification dispatch.
 */
@Entity('ai_risk_notification_outbox')
@Unique('uq_ai_risk_notification_outbox_alert_id', ['alertId'])
@Index('idx_ai_risk_notification_outbox_ready', ['status', 'nextAttemptAt'])
export class AiRiskNotificationOutbox {
  @PrimaryGeneratedColumn('uuid', { name: 'outbox_id' })
  outboxId: string;

  @Column({ name: 'alert_id', type: 'uuid' })
  alertId: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: AiRiskNotificationOutboxStatus;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamp with time zone', default: () => 'now()' })
  nextAttemptAt: Date;

  @Column({ name: 'last_attempt_at', type: 'timestamp with time zone', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone', default: () => 'now()' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone', default: () => 'now()' })
  updatedAt: Date;

  @ManyToOne(() => Alert, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alert_id' })
  alert: Relation<Alert>;
}
