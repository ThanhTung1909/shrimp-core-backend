import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Role } from '../../../common/enums/role.enum.js';

export class RegisterDto {
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Họ và tên không được để trống!' })
  fullName: string;

  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  phoneNumber: string;

  @IsNotEmpty({ message: 'Email không được để trống!' })
  @IsEmail({}, { message: 'Email không đúng định dạng!' })
  email: string;

  @IsNotEmpty({ message: 'Vai trò (role) không được để trống!' })
  @IsEnum(Role, { message: 'Vai trò (role) không hợp lệ (FARMER, MANAGER)!' })
  role: Role;
}

