import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterFcmTokenDto {
  @ApiProperty({ description: 'FCM Device Registration Token' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token: string;

  @ApiPropertyOptional({ description: 'Nền tảng thiết bị (android, ios, web)', default: 'android' })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ description: 'Mã định danh phần cứng thiết bị (IMEI/UUID)' })
  @IsString()
  @IsOptional()
  deviceIdentifier?: string;
}
