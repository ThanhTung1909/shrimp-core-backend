import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { NotificationChannel } from '../enums/notification-channel.enum.js';
import { DeliveryStatus } from '../enums/delivery-status.enum.js';

@Entity('notification_delivery')
@Unique('uq_notification_delivery_alert_user_channel', ['alertId', 'userId', 'channel'])
@Index('idx_notification_delivery_dedup', ['alertId', 'userId', 'channel'])
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid', { name: 'delivery_id' })
  deliveryId: string;

  @Column({ type: 'uuid', name: 'alert_id' })
  alertId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel',
  })
  channel: NotificationChannel;

  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    enumName: 'delivery_status',
    default: DeliveryStatus.PENDING,
  })
  status: DeliveryStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 1 })
  attemptCount: number;

  @Column({ name: 'last_attempt_at', type: 'timestamp with time zone', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamp with time zone', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 100, nullable: true })
  failureCode: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
