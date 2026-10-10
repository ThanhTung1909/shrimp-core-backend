import { Transform } from 'class-transformer';
import {
  IsEmail, IsNotEmpty, IsString, Matches, MaxLength, Validate,
  ValidateIf, ValidationArguments, ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { normalizeEmail } from '../../../common/redis/otp.constants.js';

@ValidatorConstraint({ name: 'exactlyOneRecoveryIdentifier', async: false })
class ExactlyOneRecoveryIdentifier implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as RecoveryIdentifierDto;
    return (dto.phoneNumber !== undefined) !== (dto.email !== undefined);
  }

  defaultMessage(): string {
    return 'Chỉ cung cấp một trong hai: phoneNumber hoặc email!';
  }
}

export class RecoveryIdentifierDto {
  @ValidateIf((dto) => dto.email === undefined || dto.phoneNumber !== undefined)
  @Validate(ExactlyOneRecoveryIdentifier)
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự!' })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống!' })
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Số điện thoại không hợp lệ (phải gồm 10-11 chữ số)!',
  })
  phoneNumber: string;

  @ValidateIf((dto) => dto.email !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? normalizeEmail(value) : value)
  @IsString()
  @IsEmail({}, { message: 'Email không đúng định dạng!' })
  @MaxLength(150)
  email?: string;
}
