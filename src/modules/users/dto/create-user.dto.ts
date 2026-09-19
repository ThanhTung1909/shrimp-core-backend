import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum.js';
import { Gender } from '../../../common/enums/gender.enum.js';

export class CreateUserDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống!' })
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Họ và tên phải từ 2 đến 100 ký tự!' })
  fullName: string;

  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống!' })
  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự!' })
  @Length(6, 50, { message: 'Mật khẩu phải từ 6 đến 50 ký tự!' })
  password: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng!' })
  email?: string;

  @IsOptional()
  @IsEnum(Gender, { message: 'Giới tính không hợp lệ (MALE, FEMALE, OTHER)!' })
  gender?: Gender;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh phải có định dạng YYYY-MM-DD hợp lệ!' })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Vai trò (role) không hợp lệ!' })
  role?: Role;

  @IsOptional()
  @IsBoolean({ message: 'mustChangePassword phải là boolean!' })
  mustChangePassword?: boolean;
}

