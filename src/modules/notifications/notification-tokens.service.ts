import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationToken } from './entities/notification-token.entity.js';
import { User } from '../users/entities/user.entity.js';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto.js';

@Injectable()
export class NotificationTokensService {
  private readonly logger = new Logger(NotificationTokensService.name);

  constructor(
    @InjectRepository(NotificationToken)
    private readonly tokenRepo: Repository<NotificationToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Đăng ký hoặc kích hoạt lại FCM token cho người dùng
   * Đồng bộ token mới nhất vào fallback fcm_token trên bảng users
   */
  async registerToken(
    userId: string,
    dto: RegisterFcmTokenDto,
  ): Promise<NotificationToken> {
    let existing = await this.tokenRepo.findOne({
      where: { token: dto.token },
    });

    if (existing) {
      existing.userId = userId;
      existing.platform = dto.platform || existing.platform || 'android';
      if (dto.deviceIdentifier) {
        existing.deviceIdentifier = dto.deviceIdentifier;
      }
      existing.isActive = true;
      existing.lastUsedAt = new Date();
      const saved = await this.tokenRepo.save(existing);
      await this.userRepo.update(userId, { fcmToken: dto.token });
      return saved;
    }

    const created = this.tokenRepo.create({
      userId,
      token: dto.token,
      platform: dto.platform || 'android',
      deviceIdentifier: dto.deviceIdentifier || null,
      isActive: true,
      lastUsedAt: new Date(),
    });

    const saved = await this.tokenRepo.save(created);
    await this.userRepo.update(userId, { fcmToken: dto.token });
    return saved;
  }

  /**
   * Hủy kích hoạt token cho người dùng (đảm bảo tính sở hữu)
   */
  async unregisterToken(userId: string, token: string): Promise<boolean> {
    const existing = await this.tokenRepo.findOne({
      where: { token },
    });

    if (!existing) {
      throw new NotFoundException('FCM token không tồn tại trong hệ thống.');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('Không có quyền hủy đăng ký token của người dùng khác.');
    }

    existing.isActive = false;
    await this.tokenRepo.save(existing);

    // Xóa fallback token nếu trùng khớp
    await this.userRepo.update(
      { userId, fcmToken: token },
      { fcmToken: null },
    );

    return true;
  }

  /**
   * Vô hiệu hóa hàng loạt các token không hợp lệ (được phát hiện bởi FCM SDK)
   */
  async deactivateTokens(tokens: string[]): Promise<number> {
    if (!tokens || tokens.length === 0) {
      return 0;
    }

    const result = await this.tokenRepo.update(
      { token: In(tokens) },
      { isActive: false },
    );

    // Cập nhật fallback users
    await this.userRepo.update(
      { fcmToken: In(tokens) },
      { fcmToken: null },
    );

    return result.affected || 0;
  }

  /**
   * Lấy danh sách active tokens của user (có fallback sang User.fcmToken)
   */
  async getActiveTokens(userId: string): Promise<string[]> {
    const tokens = await this.tokenRepo.find({
      where: { userId, isActive: true },
    });

    const activeList = tokens.map((t) => t.token);

    if (activeList.length === 0) {
      const user = await this.userRepo.findOne({
        where: { userId },
        select: ['userId', 'fcmToken'],
      });
      if (user?.fcmToken) {
        return [user.fcmToken];
      }
    }

    return Array.from(new Set(activeList));
  }

  /**
   * Danh sách thiết bị / tokens của user
   */
  async listUserTokens(userId: string): Promise<NotificationToken[]> {
    return this.tokenRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}
