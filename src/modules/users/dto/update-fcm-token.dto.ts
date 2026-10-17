import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateFcmTokenDto {
  @IsNotEmpty({ message: 'fcmToken không được để trống!' })
  @IsString({ message: 'fcmToken phải là chuỗi ký tự!' })
  fcmToken: string;
}
