import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { PredictionType } from '../../../common/enums/prediction-type.enum.js';
import { RiskLevel } from '../../../common/enums/risk-level.enum.js';
import { Pond } from '../../ponds/entities/pond.entity.js';

/**
 * Entity AiPrediction (Bảng ai_prediction)
 * Lưu trữ kết quả dự báo chất lượng nước (Oxy DO, pH) và điểm rủi ro trong tương lai từ mô hình AI.
 */
@Entity('ai_prediction')
@Index('idx_ai_prediction_pond_type_created', ['pondId', 'predictionType', 'createdAt'])
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
    name: 'risk_level',
    type: 'enum',
    enum: RiskLevel,
    enumName: 'risk_level',
  })
  riskLevel: RiskLevel;

  // Cờ nhận biết kết quả từ AI Microservice hay từ mô hình Heuristic Fallback
  @Column({ name: 'is_fallback', type: 'boolean', default: false })
  isFallback: boolean;

  // Nguồn gốc tính toán dự báo: 'AI_MICROSERVICE' hoặc 'HEURISTIC_RULE'
  @Column({
    name: 'prediction_source',
    type: 'varchar',
    length: 50,
    default: 'AI_MICROSERVICE',
  })
  predictionSource: string;

  // Loại dự báo: WATER_QUALITY hoặc DISEASE_RISK
  @Column({
    name: 'prediction_type',
    type: 'varchar',
    length: 30,
    default: PredictionType.WATER_QUALITY,
  })
  predictionType: PredictionType;

  // Dự báo nhiệt độ nước (°C)
  @Column({ name: 'predicted_temperature', type: 'double precision', nullable: true })
  predictedTemperature: number | null;

  // Khung thời gian dự báo (giờ)
  @Column({ name: 'horizon_hours', type: 'int', nullable: true })
  horizonHours: number | null;

  // Payload chi tiết (chuỗi dự báo theo giờ hoặc phân tích rủi ro từng bệnh)
  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload: Record<string, any> | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
    default: () => 'now()',
  })
  createdAt: Date;

  // Quan hệ ManyToOne với Pond: 1 Ao nuôi có thể có nhiều bản ghi dự báo lịch sử và tương lai
  @ManyToOne(() => Pond, (pond) => pond.predictions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pond_id' })
  pond: Relation<Pond>;
}
