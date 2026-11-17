import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportDeviceFaultDto {
  @ApiPropertyOptional({
    description: 'Lý do hoặc mô tả chi tiết sự cố / hư hỏng của thiết bị IoT',
    example: 'Cảm biến oxy hòa tan DO không trả dữ liệu, đèn LED báo nháy đỏ liên tục',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Mô tả sự cố không vượt quá 500 ký tự' })
  reason?: string;
}
