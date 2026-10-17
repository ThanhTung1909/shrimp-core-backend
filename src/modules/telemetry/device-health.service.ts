import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { TelemetryService } from './telemetry.service.js';

@Injectable()
export class DeviceHealthService {
  private readonly logger = new Logger(DeviceHealthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly telemetryService: TelemetryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    try {
      this.logger.debug('[Cron] Đang quét kiểm tra các thiết bị mất kết nối...');
      const timeoutMinutes = this.configService.get<number>('DEVICE_STALE_TIMEOUT_MINUTES') || 15;
      await this.telemetryService.checkAndMarkOfflineDevices(timeoutMinutes);
    } catch (error) {
      this.logger.error('[Cron] Lỗi khi quét thiết bị mất kết nối', error);
    }
  }
}
