import {
  IsDateString,
  IsEnum,
  IsMACAddress,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString({ message: 'Tên thiết bị phải là chuỗi ký tự!' })
  @Length(2, 100, { message: 'Tên thiết bị phải từ 2 đến 100 ký tự!' })
  deviceName?: string;

  @IsOptional()
  @IsString({ message: 'Địa chỉ MAC phải là chuỗi ký tự!' })
  @IsMACAddress({
    message: 'Địa chỉ MAC không đúng định dạng!',
  })
  macAddress?: string;

  @IsOptional()
  @IsUUID()
  pondId?: string;

  @IsOptional()
  @IsString({ message: 'Phiên bản firmware phải là chuỗi ký tự!' })
  @Length(1, 50, { message: 'Phiên bản firmware từ 1 đến 50 ký tự!' })
  firmwareVersion?: string;

  @IsOptional()
  @IsEnum(DeviceStatus, { message: 'Trạng thái thiết bị không hợp lệ!' })
  status?: DeviceStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Thời gian hoạt động gần nhất phải theo chuẩn ISO Date!' })
  lastActiveAt?: string;
}
