import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service.js';
import { User } from '../../users/entities/user.entity.js';
import { RedisService } from '../../../common/redis/redis.service.js';
import { getAccessTokenBlacklistKey } from '../../../common/redis/rate-limit.constants.js';
import { getLoginPendingManualKey } from '../../../common/redis/login-lockout.constants.js';

export interface JwtPayload {
  sub: string;
  phoneNumber?: string;
  tokenVersion: number;
  role: string;
  type: string;
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    @Optional()
    private readonly redisService?: RedisService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_ACCESS_SECRET chưa được cấu hình trong biến môi trường!',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<Omit<User, 'passwordHash'>> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Token không hợp lệ!');
    }

    if (!payload.jti || typeof payload.jti !== 'string') {
      throw new UnauthorizedException('Token không hợp lệ!');
    }

    // Check Redis access-token blacklist (per-device logout revocation)
    if (!this.redisService) {
      throw new UnauthorizedException(
        'Dịch vụ xác thực tạm thời không khả dụng!',
      );
    }

    try {
      const blacklistKey = getAccessTokenBlacklistKey(payload.jti);
      const isBlacklisted = await this.redisService.get(blacklistKey);
      if (isBlacklisted !== null) {
        throw new UnauthorizedException('Token đã bị thu hồi!');
      }
      if (await this.redisService.get(getLoginPendingManualKey(payload.sub)) !== null) {
        throw new UnauthorizedException('Token không hợp lệ!');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Fail-closed: Redis lookup failure must NOT silently authenticate
      throw new UnauthorizedException('Không thể xác thực trạng thái token!');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive || user.isLocked) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại hoặc đã bị khóa!',
      );
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Token không hợp lệ!');
    }
    return this.usersService.sanitizeUser(user);
  }
}
