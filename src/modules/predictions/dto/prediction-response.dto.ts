import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PredictionType } from '../../../common/enums/prediction-type.enum.js';
import { RiskLevel } from '../../../common/enums/risk-level.enum.js';

export class WaterQualityCurrentMetricsDto {
  @ApiPropertyOptional({ type: Number, nullable: true, example: 5.2 })
  currentDO: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 7.7 })
  currentPH: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 28.5 })
  currentTemp: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 15.0 })
  salinity: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 20.0 })
  turbidity: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-11-22T02:00:00.000Z' })
  recordedAt: string | null;
}

export class WaterQualityForecastSummaryDto {
  @ApiProperty({ example: 4.1 })
  minDO: number;

  @ApiProperty({ example: 6.2 })
  maxDO: number;

  @ApiProperty({ example: 5.1 })
  avgDO: number;

  @ApiProperty({ example: 7.5 })
  minPH: number;

  @ApiProperty({ example: 8.1 })
  maxPH: number;

  @ApiProperty({ example: 27.2 })
  minTemperature: number;

  @ApiProperty({ example: 30.1 })
  maxTemperature: number;

  @ApiProperty({ example: 0.42 })
  peakRiskScore: number;

  @ApiProperty({ example: 18 })
  peakRiskOffsetHours: number;

  @ApiProperty({ example: '2026-11-22T20:00:00.000Z' })
  peakRiskTime: string;
}

export class WaterQualityForecastPointDto {
  @ApiProperty({ example: 1 })
  offsetHours: number;

  @ApiProperty({ example: '2026-11-22T03:00:00.000Z' })
  predictedTime: string;

  @ApiProperty({ example: 5.05 })
  predictedDO: number;

  @ApiProperty({ example: 7.72 })
  predictedPH: number;

  @ApiProperty({ example: 28.8 })
  predictedTemperature: number;

  @ApiProperty({ example: 0.15 })
  riskScore: number;

  @ApiProperty({ enum: RiskLevel, example: RiskLevel.LOW })
  riskLevel: RiskLevel;
}

export class WaterQualityForecastResponseDto {
  @ApiProperty({ example: 'c45b4a78-9d25-4e0e-bf1a-6a1f9f7b1234' })
  predictionId: string;

  @ApiProperty({ example: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb' })
  pondId: string;

  @ApiProperty({ enum: PredictionType, example: PredictionType.WATER_QUALITY })
  predictionType: PredictionType;

  @ApiProperty({ example: '2026-11-22T02:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ example: '2026-11-23T02:00:00.000Z' })
  predictedTime: string;

  @ApiProperty({ example: 24 })
  horizonHours: number;

  @ApiProperty({ example: 1 })
  stepHours: number;

  @ApiProperty({ example: false })
  cached: boolean;

  @ApiProperty({ example: false })
  isFallback: boolean;

  @ApiProperty({ example: 'AI_MICROSERVICE' })
  predictionSource: string;

  @ApiProperty({ example: 0.25 })
  riskScore: number;

  @ApiProperty({ enum: RiskLevel, example: RiskLevel.LOW })
  riskLevel: RiskLevel;

  @ApiProperty({ type: WaterQualityCurrentMetricsDto })
  currentMetrics: WaterQualityCurrentMetricsDto;

  @ApiProperty({ type: WaterQualityForecastSummaryDto })
  summary: WaterQualityForecastSummaryDto;

  @ApiProperty({ type: [WaterQualityForecastPointDto] })
  series: WaterQualityForecastPointDto[];

  @ApiProperty({ type: [String] })
  factors: string[];

  @ApiProperty({ type: [String] })
  recommendations: string[];
}

export class DiseaseRiskItemDto {
  @ApiProperty({ example: 'WSSV' })
  diseaseCode: string;

  @ApiProperty({ example: 'Bệnh đốm trắng (WSSV)' })
  diseaseName: string;

  @ApiProperty({ example: 0.28 })
  riskScore: number;

  @ApiProperty({ enum: RiskLevel, example: RiskLevel.LOW })
  riskLevel: RiskLevel;

  @ApiProperty({ type: [String] })
  indicators: string[];

  @ApiProperty({ type: [String] })
  recommendations: string[];
}

export class DiseaseRiskInputSnapshotDto {
  @ApiPropertyOptional({ type: Number, nullable: true, example: 5.2 })
  currentDO: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 7.7 })
  currentPH: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 28.5 })
  currentTemp: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 15.0 })
  salinity: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 20.0 })
  turbidity: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 0.03 })
  nh3: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 0.25 })
  no2: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 1.8 })
  temperatureDelta24h: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 0.25 })
  phDelta24h: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 4.5 })
  minDO24h: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 27.1 })
  minTemp24h: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 29.5 })
  maxTemp24h: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 35 })
  daysOfCulture: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Litopenaeus vannamei' })
  shrimpSpecies: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 120 })
  shrimpDensity: number | null;
}

export class DiseaseRiskResponseDto {
  @ApiProperty({ example: '820c99e7-90b5-4a2b-8f4d-349c947d5678' })
  predictionId: string;

  @ApiProperty({ example: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb' })
  pondId: string;

  @ApiProperty({ enum: PredictionType, example: PredictionType.DISEASE_RISK })
  predictionType: PredictionType;

  @ApiProperty({ example: '2026-11-22T02:00:00.000Z' })
  assessedAt: string;

  @ApiProperty({ example: '2026-11-23T02:00:00.000Z' })
  validUntil: string;

  @ApiProperty({ example: false })
  cached: boolean;

  @ApiProperty({ example: false })
  isFallback: boolean;

  @ApiProperty({ example: 'AI_MICROSERVICE' })
  predictionSource: string;

  @ApiProperty({ example: 0.35 })
  overallRiskScore: number;

  @ApiProperty({ enum: RiskLevel, example: RiskLevel.LOW })
  overallRiskLevel: RiskLevel;

  @ApiProperty({ type: [DiseaseRiskItemDto] })
  diseases: DiseaseRiskItemDto[];

  @ApiProperty({ type: DiseaseRiskInputSnapshotDto })
  inputSnapshot: DiseaseRiskInputSnapshotDto;

  @ApiProperty({ type: [String] })
  recommendations: string[];
}
