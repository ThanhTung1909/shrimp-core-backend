import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber: string;

  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Mật khẩu không được để trống!' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu phải từ 6 ký tự!' })
  password: string;
}