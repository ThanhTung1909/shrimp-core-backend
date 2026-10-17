import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { Pond } from './pond.entity.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * Entity ManualTestLog (Bảng manual_test_log)
 * Lưu trữ các bản ghi đo khí độc (NH3, NO2) thủ công bằng bộ kit thử nghiệm nhanh.
 */
@Entity('manual_test_log')
export class ManualTestLog {
  @PrimaryGeneratedColumn('uuid', { name: 'log_id' })
  logId: string;

  @Column({ type: 'uuid', name: 'pond_id' })
  pondId: string;

  @Column({ type: 'uuid', name: 'tested_by' })
  testedById: string;

  // Nồng độ khí độc NH3 (Amoniac) - Đơn vị mg/L
  @Column({ name: 'nh3_value', type: 'double precision' })
  nh3Value: number;

  // Nồng độ khí độc NO2 (Nitrit) - Đơn vị mg/L
  @Column({ name: 'no2_value', type: 'double precision' })
  no2Value: number;

  // Ghi chú thêm ngoài thực địa (ví dụ: "Nước có váng bọt nhẹ góc ao")
  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  // Mốc thời gian thực hiện đo
  @CreateDateColumn({
    name: 'tested_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  testedAt: Date;

  // Quan hệ ManyToOne với Pond: 1 Ao có nhiều nhật ký đo thủ công
  @ManyToOne(() => Pond, (pond) => pond.manualLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;

  // Quan hệ ManyToOne với User: Lưu lại định danh Kỹ thuật viên / Nông dân đã đo
  @ManyToOne(() => User, (user) => user.testedLogs, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tested_by' })
  testedBy: Relation<User>;
}
