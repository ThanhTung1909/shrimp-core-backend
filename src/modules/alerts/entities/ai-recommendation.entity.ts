import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { Alert } from './alert.entity.js';

/**
 * Entity AiRecommendation (Bảng ai_recommendation)
 * Lưu trữ lời khuyên/hướng dẫn khắc phục do mô hình AI sinh ra khi có cảnh báo.
 * Quan hệ 1 - 1 với bảng Alert.
 */
@Entity('ai_recommendation')
export class AiRecommendation {
  @PrimaryGeneratedColumn('uuid', { name: 'recommendation_id' })
  recommendationId: string;

  @Column({ type: 'uuid', name: 'alert_id' })
  alertId: string;

  // Lời khuyên hành động (ví dụ: "Tạt 10-15kg vôi Dolomite ngay lập tức")
  @Column({ name: 'action_suggestion', type: 'text' })
  actionSuggestion: string;

  // Liều lượng hóa chất / chế phẩm sinh học (ví dụ: "15 kg/1000m3")
  @Column({
    name: 'chemical_dosage',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  chemicalDosage: string | null;

  /**
   * Quan hệ 1 - 1 với Alert:
   * - @OneToOne: Khai báo quan hệ 1-1 giữa 2 bảng
   * - @JoinColumn({ name: 'alert_id' }): Báo cho TypeORM biết bảng ai_recommendation
   *   sẽ là bên giữ cột khóa ngoại alert_id trỏ sang bảng alert.
   * - onDelete: 'CASCADE': Nếu sự cố Alert bị xóa thì lời khuyên này cũng tự động xóa theo.
   */
  @OneToOne(() => Alert, (alert) => alert.recommendation, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'alert_id' })
  alert: Relation<Alert>;
}
