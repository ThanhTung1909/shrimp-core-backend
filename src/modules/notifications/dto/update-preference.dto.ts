import { IsArray, IsBoolean, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertLevel } from '../../../common/enums/alert-level.enum.js';
import { NotificationChannel } from '../enums/notification-channel.enum.js';

export class UpdatePreferenceDto {
  @ApiProperty({ enum: AlertLevel, description: 'Mức độ cảnh báo (WARNING, CRITICAL)' })
  @IsEnum(AlertLevel)
  severity: AlertLevel;

  @ApiProperty({ enum: NotificationChannel, description: 'Kênh thông báo (FCM, SMS, EMAIL)' })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({ description: 'Trạng thái bật/tắt nhận thông báo' })
  @IsBoolean()
  enabled: boolean;
}

export class PreferenceItemDto extends UpdatePreferenceDto {}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ type: [PreferenceItemDto], description: 'Danh sách cấu hình thông báo cần cập nhật' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences?: PreferenceItemDto[];

  @ApiPropertyOptional({ enum: AlertLevel, description: 'Mức độ cảnh báo (nếu update đơn lẻ)' })
  @IsOptional()
  @IsEnum(AlertLevel)
  severity?: AlertLevel;

  @ApiPropertyOptional({ enum: NotificationChannel, description: 'Kênh thông báo (nếu update đơn lẻ)' })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ description: 'Trạng thái bật/tắt nhận thông báo (nếu update đơn lẻ)' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
