import { PartialType } from '@nestjs/mapped-types';
import { CreatePondDto } from './create-pond.dto.js';

export class UpdatePondDto extends PartialType(CreatePondDto) {}
