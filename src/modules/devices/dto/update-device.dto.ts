import { PartialType } from '@nestjs/mapped-types';
import { CreateDeviceDto } from './create-device.dto.js';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {}



