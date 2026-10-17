import { IsEnum, IsNotEmpty } from 'class-validator';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';

export class UpdateDeviceStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống!' })
  @IsEnum(DeviceStatus, { message: 'Trạng thái thiết bị không hợp lệ!' })
  status: DeviceStatus;
}
