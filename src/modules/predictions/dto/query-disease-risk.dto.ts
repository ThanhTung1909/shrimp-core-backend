import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class QueryDiseaseRiskDto {
  @ApiPropertyOptional({
    description: 'Bỏ qua cache 15 phút và đánh giá lại rủi ro dịch bệnh mới',
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
