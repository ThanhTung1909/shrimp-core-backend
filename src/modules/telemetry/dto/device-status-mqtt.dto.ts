import { IsEnum } from 'class-validator';
import { DeviceStatus } from '../../../common/enums/device-status.enum.js';

export class DeviceStatusMqttDto {
  @IsEnum(DeviceStatus)
  status: DeviceStatus;
}
