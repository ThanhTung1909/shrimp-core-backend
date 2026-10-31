import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnregisterFcmTokenDto {
  @ApiProperty({ description: 'FCM Device Registration Token cần hủy đăng ký' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token: string;
}
