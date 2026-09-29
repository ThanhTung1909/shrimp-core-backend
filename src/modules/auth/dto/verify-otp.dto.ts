import { IsEnum, IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { OtpPurpose } from '../../../common/redis/otp.constants.js';

export class VerifyOtpDto {
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber: string;

  @IsString({ message: 'Mã OTP phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Mã OTP không được để trống!' })
  @Length(6, 6, { message: 'Mã OTP phải bao gồm đúng 6 chữ số!' })
  otp: string;

  @IsEnum(OtpPurpose, { message: 'Mục đích xác thực OTP không hợp lệ!' })
  @IsNotEmpty({ message: 'Mục đích xác thực OTP không được để trống!' })
  purpose: OtpPurpose;
}
