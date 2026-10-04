import { IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';
import { OtpPurpose } from '../../../common/redis/otp.constants.js';

export class SendOtpDto {
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber: string;

  @IsEnum(OtpPurpose, { message: 'Mục đích gửi OTP không hợp lệ!' })
  @IsNotEmpty({ message: 'Mục đích gửi OTP không được để trống!' })
  purpose: OtpPurpose;
}
