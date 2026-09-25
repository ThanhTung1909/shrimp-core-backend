import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PondStatus } from '../../../common/enums/pond-status.enum.js';

export class UpdatePondDto {
  @IsOptional()
  @IsString({ message: 'Tên ao phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Tên ao phải từ 2 đến 100 ký tự!' })
  pondName?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Diện tích ao phải là số thực!' })
  @IsPositive({ message: 'Diện tích ao phải lớn hơn 0!' })
  areaM2?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Độ sâu ao phải là số thực!' })
  @IsPositive({ message: 'Độ sâu ao phải lớn hơn 0!' })
  depthM?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Mật độ tôm phải là số nguyên!' })
  @IsPositive({ message: 'Mật độ tôm phải lớn hơn 0!' })
  shrimpDensity?: number;

  @IsOptional()
  @IsEnum(PondStatus, { message: 'Trạng thái ao không hợp lệ!' })
  status?: PondStatus;

  @IsOptional()
  @IsString({ message: 'userId phải là chuỗi ký tự!' })
  userId?: string;
}
