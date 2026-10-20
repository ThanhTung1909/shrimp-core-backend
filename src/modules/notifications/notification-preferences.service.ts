import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity.js';
import { AlertLevel } from '../../common/enums/alert-level.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import {
  UpdatePreferenceDto,
  UpdatePreferencesDto,
} from './dto/update-preference.dto.js';

export interface DefaultPreferenceConfig {
  severity: AlertLevel;
  channel: NotificationChannel;
  enabled: boolean;
}

export const DEFAULT_PREFERENCES: DefaultPreferenceConfig[] = [
  { severity: AlertLevel.CRITICAL, channel: NotificationChannel.FCM, enabled: true },
  { severity: AlertLevel.CRITICAL, channel: NotificationChannel.SMS, enabled: true },
  { severity: AlertLevel.CRITICAL, channel: NotificationChannel.EMAIL, enabled: true },
  { severity: AlertLevel.WARNING, channel: NotificationChannel.FCM, enabled: true },
  { severity: AlertLevel.WARNING, channel: NotificationChannel.SMS, enabled: false },
  { severity: AlertLevel.WARNING, channel: NotificationChannel.EMAIL, enabled: false },
];

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly prefRepo: Repository<NotificationPreference>,
  ) {}

  /**
   * Khởi tạo cài đặt mặc định cho user nếu chưa có bản ghi
   */
  async ensureDefaultPreferences(userId: string): Promise<NotificationPreference[]> {
    const existing = await this.prefRepo.find({ where: { userId } });
    if (existing && existing.length > 0) {
      return existing;
    }

    const createdEntities = DEFAULT_PREFERENCES.map((def) =>
      this.prefRepo.create({
        userId,
        severity: def.severity,
        channel: def.channel,
        enabled: def.enabled,
      }),
    );

    try {
      return await this.prefRepo.save(createdEntities);
    } catch {
      // Trường hợp race condition duplicate, query lại
      return (await this.prefRepo.find({ where: { userId } })) || [];
    }
  }

  /**
   * Lấy toàn bộ cài đặt nhận thông báo của người dùng
   */
  async getUserPreferences(userId: string): Promise<NotificationPreference[]> {
    const prefs = await this.prefRepo.find({
      where: { userId },
      order: { severity: 'ASC', channel: 'ASC' },
    });

    if (prefs && prefs.length > 0) {
      return prefs;
    }

    return this.ensureDefaultPreferences(userId);
  }

  /**
   * Kiểm tra một kênh có được bật cho mức độ cảnh báo hay không
   */
  async isChannelEnabled(
    userId: string,
    severity: AlertLevel,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const pref = await this.prefRepo.findOne({
      where: { userId, severity, channel },
    });

    if (pref) {
      return pref.enabled;
    }

    // Fallback theo DEFAULT_PREFERENCES
    const def = DEFAULT_PREFERENCES.find(
      (p) => p.severity === severity && p.channel === channel,
    );
    return def ? def.enabled : false;
  }

  /**
   * Cập nhật cài đặt nhận thông báo (đơn lẻ hoặc danh sách)
   */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto | UpdatePreferenceDto,
  ): Promise<NotificationPreference[]> {
    const itemsToUpdate: Array<{
      severity: AlertLevel;
      channel: NotificationChannel;
      enabled: boolean;
    }> = [];

    // Hỗ trợ cả định dạng mảng (preferences: [...]) và đơn lẻ ({ severity, channel, enabled })
    if ('preferences' in dto && Array.isArray(dto.preferences) && dto.preferences.length > 0) {
      for (const item of dto.preferences) {
        this.validatePreferenceItem(item.severity, item.channel);
        itemsToUpdate.push(item);
      }
    } else if (
      'severity' in dto &&
      dto.severity !== undefined &&
      'channel' in dto &&
      dto.channel !== undefined &&
      'enabled' in dto &&
      dto.enabled !== undefined
    ) {
      this.validatePreferenceItem(dto.severity, dto.channel);
      itemsToUpdate.push({
        severity: dto.severity,
        channel: dto.channel,
        enabled: dto.enabled,
      });
    } else {
      throw new BadRequestException('Dữ liệu cập nhật preference không hợp lệ.');
    }

    for (const item of itemsToUpdate) {
      let existing = await this.prefRepo.findOne({
        where: {
          userId,
          severity: item.severity,
          channel: item.channel,
        },
      });

      if (existing) {
        existing.enabled = item.enabled;
        await this.prefRepo.save(existing);
      } else {
        const newPref = this.prefRepo.create({
          userId,
          severity: item.severity,
          channel: item.channel,
          enabled: item.enabled,
        });
        await this.prefRepo.save(newPref);
      }
    }

    return this.getUserPreferences(userId);
  }

  private validatePreferenceItem(severity: any, channel: any) {
    if (!Object.values(AlertLevel).includes(severity)) {
      throw new BadRequestException(`Mức độ cảnh báo không hợp lệ: ${severity}`);
    }
    if (!Object.values(NotificationChannel).includes(channel)) {
      throw new BadRequestException(`Kênh thông báo không hợp lệ: ${channel}`);
    }
  }
}
