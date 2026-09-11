import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { RiskLevel } from '../../../common/enums/risk-level.enum.js';
import { Pond } from '../../ponds/entities/pond.entity.js';

/**
 * Entity AiPrediction (Bảng ai_prediction)
 * Lưu trữ kết quả dự báo chất lượng nước (Oxy DO, pH) và điểm rủi ro trong tương lai từ mô hình AI.
 */
@Entity('ai_prediction')
export class AiPrediction {
  @PrimaryGeneratedColumn('uuid', { name: 'prediction_id' })
  predictionId: string;

  @Column({ type: 'uuid', name: 'pond_id' })
  pondId: string;

  // Mốc thời gian được dự báo (ví dụ: dự báo chất lượng nước lúc 2h00 sáng hôm sau)
  @Column({ name: 'predicted_time', type: 'timestamp with time zone' })
  predictedTime: Date;

  // Dự báo nồng độ Oxy hòa tan (mg/L)
  @Column({ name: 'predicted_do', type: 'double precision' })
  predictedDO: number;

  // Dự báo độ pH
  @Column({ name: 'predicted_ph', type: 'double precision' })
  predictedPH: number;

  // Điểm số rủi ro tính từ mô hình (từ 0.0 đến 1.0)
  @Column({ name: 'risk_score', type: 'double precision' })
  riskScore: number;

  // Phân loại rủi ro: LOW, MEDIUM, HIGH
  @Column({
    type: 'enum',
    enum: RiskLevel,
    enumName: 'risk_level',
  })
  riskLevel: RiskLevel;

  // Quan hệ ManyToOne với Pond: 1 Ao nuôi có thể có nhiều bản ghi dự báo lịch sử và tương lai
  @ManyToOne(() => Pond, (pond) => pond.predictions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;
}
