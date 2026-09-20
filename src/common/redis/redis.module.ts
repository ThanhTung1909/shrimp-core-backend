import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { OtpService } from './otp.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService, RateLimitService, OtpService],
  exports: [RedisService, RateLimitService, OtpService],
})
export class RedisModule {}