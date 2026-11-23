import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryWaterQualityForecastDto {
  @ApiPropertyOptional({
    description: 'Khung thời gian dự báo (giờ), từ 12 đến 24 giờ',
    minimum: 12,
    maximum: 24,
    default: 24,
    example: 24,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(12)
  @Max(24)
  horizonHours?: number = 24;

  @ApiPropertyOptional({
    description: 'Bước nhảy theo giờ giữa các điểm dự báo',
    enum: [1, 2, 3, 4, 6],
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3, 4, 6])
  stepHours?: number = 1;

  @ApiPropertyOptional({
    description: 'Bỏ qua cache 15 phút và tính toán lại dự báo mới',
    default: false,
    example: false,
  })
  @IsOptional()
  @Transform(({ value, obj, key }) => {
    const raw =
      obj && typeof obj === 'object' && key in obj
        ? (obj as Record<string, unknown>)[key]
        : value;
    if (raw === undefined) return false;
    if (raw === false || raw === 'false') return false;
    if (raw === true || raw === 'true') return true;
    return raw;
  })
  @IsBoolean()
  refresh?: boolean = false;
}
