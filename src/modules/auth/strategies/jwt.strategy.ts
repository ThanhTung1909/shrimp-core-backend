import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        configService: ConfigService,
        private readonly usersService: UsersService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
            algorithms: ['HS256'],
        });
    }

    async validate(payload: {
        sub: string;
        tokenVersion: number;
        role: string;
        type: string
    }) {
        if (payload.type !== 'access') {
            throw new UnauthorizedException('Token không hợp lệ!');
        }
        const user = await this.usersService.findById(payload.sub);

        if (!user || !user.isActive) {
            throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị khóa!');
        }

        if (user.tokenVersion !== payload.tokenVersion) {
            throw new UnauthorizedException('Token không hợp lệ!');
        }
        return user;
    }
}