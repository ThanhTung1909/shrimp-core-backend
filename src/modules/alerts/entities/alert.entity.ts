import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { AlertLevel } from '../../../common/enums/alert-level.enum.js';
import { AlertStatus } from '../../../common/enums/alert-status.enum.js';
import { Pond } from '../../ponds/entities/pond.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { Device } from '../../devices/entities/device.entity.js';
import { AiRecommendation } from './ai-recommendation.entity.js';

/**
 * Entity Alert (Bảng alert)
 * Lưu trữ các sự cố cảnh báo khi chỉ số đo từ cảm biến vượt ngưỡng nguy hiểm.
 */
@Entity('alert')
export class Alert {
  @PrimaryGeneratedColumn('uuid', { name: 'alert_id' })
  alertId: string;

  @Column({ type: 'uuid', name: 'pond_id' })
  pondId: string;

  @Column({ type: 'uuid', name: 'device_id', nullable: true })
  deviceId: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  // Người xử lý sự cố (có thể null khi sự cố mới phát sinh chưa ai nhận)
  @Column({ type: 'uuid', name: 'resolved_by', nullable: true })
  resolvedById: string | null;

  // Tên chỉ số gây ra cảnh báo (ví dụ: 'dissolvedOxygen', 'pH')
  @Column({ name: 'metric_name', type: 'varchar', length: 50 })
  metricName: string;

  // Giá trị thực tế đo được khiến kích hoạt cảnh báo (ví dụ: DO tụt xuống 2.8 mg/L)
  @Column({ name: 'triggered_value', type: 'double precision' })
  triggeredValue: number;

  // Mức độ cảnh báo: WARNING hoặc CRITICAL
  @Column({
    type: 'enum',
    enum: AlertLevel,
    enumName: 'alert_level',
    default: AlertLevel.WARNING,
  })
  alertLevel: AlertLevel;

  // Trạng thái sự cố: ACTIVE hoặc RESOLVED
  @Column({
    type: 'enum',
    enum: AlertStatus,
    enumName: 'alert_status',
    default: AlertStatus.ACTIVE,
  })
  status: AlertStatus;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  createdAt: Date;

  @Column({
    name: 'resolved_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  // 1. Quan hệ ManyToOne với Pond: Nhiều sự cố Alert thuộc về 1 Ao nuôi (Pond)
  @ManyToOne(() => Pond, (pond) => pond.alerts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;

  // 2. Quan hệ ManyToOne với User: 1 Kỹ thuật viên (User) có thể xử lý nhiều Alert
  // onDelete: 'SET NULL': Nếu tài khoản người dùng bị xóa thì sự cố vẫn giữ lại và cột resolved_by thành null
  @ManyToOne(() => User, (user) => user.resolvedAlerts, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'resolved_by' })
  resolvedBy: Relation<User> | null;

  // 3. Quan hệ 1 - 1 với AiRecommendation: 1 Alert được nối với 1 lời khuyên AI
  @OneToOne(() => AiRecommendation, (rec) => rec.alert)
  recommendation: Relation<AiRecommendation>;

  @ManyToOne(() => Device, (device) => device.alerts, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'device_id' })
  device: Relation<Device> | null;
}
