import { IsEmail, IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Role } from '../../../common/enums/role.enum.js';

export class RegisterDto {
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Họ và tên không được để trống!' })
  fullName: string;

  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber: string;

  @IsNotEmpty({ message: 'Email không được để trống!' })
  @IsEmail({}, { message: 'Email không đúng định dạng!' })
  email: string;

  @IsNotEmpty({ message: 'Vai trò (role) không được để trống!' })
  @IsEnum(Role, { message: 'Vai trò (role) không hợp lệ (FARMER, MANAGER)!' })
  role: Role;
}

