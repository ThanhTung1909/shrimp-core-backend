import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { OtpService } from './otp.service.js';
import { LoginLockoutService } from './login-lockout.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService, RateLimitService, OtpService, LoginLockoutService],
  exports: [RedisService, RateLimitService, OtpService, LoginLockoutService],
})
export class RedisModule {}
