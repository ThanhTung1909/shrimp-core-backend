import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';

export class CreateDeviceDto {
  @IsNotEmpty({ message: 'Tên thiết bị không được để trống!' })
  @IsString({ message: 'Tên thiết bị phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Tên thiết bị phải từ 2 đến 100 ký tự!' })
  deviceName: string;

  @IsNotEmpty({ message: 'Địa chỉ MAC không được để trống!' })
  @IsString({ message: 'Địa chỉ MAC phải là chuỗi ký tự!' })
  @Length(6, 50, { message: 'Địa chỉ MAC phải từ 6 đến 50 ký tự!' })
  macAddress: string;

  @IsNotEmpty({ message: 'Ao nuôi (pondId) không được để trống!' })
  @IsUUID()
  pondId: string;

  @IsOptional()
  @IsString({ message: 'Phiên bản firmware phải là chuỗi ký tự!' })
  @Length(1, 50, { message: 'Phiên bản firmware từ 1 đến 50 ký tự!' })
  firmwareVersion?: string;

  @IsOptional()
  @IsEnum(DeviceStatus, { message: 'Trạng thái thiết bị không hợp lệ!' })
  status?: DeviceStatus;
}
