import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class LoginDto {
    @IsString()
    @IsNotEmpty()
    phoneNumber: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;
}