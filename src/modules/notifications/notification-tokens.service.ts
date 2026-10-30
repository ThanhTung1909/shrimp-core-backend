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
   * Registers a device token for its owner.
   *
   * An active token cannot be claimed by another account. A device handoff is
   * permitted only after its prior owner explicitly unregisters it, which
   * marks the token inactive before the next account claims it.
   */
  async registerToken(
    userId: string,
    dto: RegisterFcmTokenDto,
  ): Promise<NotificationToken> {
    let existing = await this.tokenRepo.findOne({
      where: { token: dto.token },
    });

    if (existing) {
      if (existing.userId !== userId && existing.isActive) {
        throw new ForbiddenException(
          'FCM token đang được liên kết với một tài khoản khác. Hãy đăng xuất thiết bị khỏi tài khoản cũ trước.',
        );
      }

      if (existing.userId !== userId) {
        // A previously inactive token is a valid explicit device handoff.
        // Clear every legacy fallback reference before assigning the new owner.
        await this.userRepo.update(
          { userId: existing.userId, fcmToken: dto.token },
          { fcmToken: null },
        );
      }
      existing.userId = userId;
      existing.platform = dto.platform || existing.platform || 'android';
      if (dto.deviceIdentifier) {
        existing.deviceIdentifier = dto.deviceIdentifier;
      }
      existing.isActive = true;
      existing.lastUsedAt = new Date();
      const saved = await this.tokenRepo.save(existing);
      await this.userRepo.update({ fcmToken: dto.token }, { fcmToken: null });
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

    let saved: NotificationToken;
    try {
      saved = await this.tokenRepo.save(created);
    } catch (error: any) {
      // The global unique constraint is the final guard for concurrent
      // registrations that both observed no existing row. Translate the
      // losing cross-user request into the same ownership response.
      if (error?.code !== '23505') {
        throw error;
      }

      const winner = await this.tokenRepo.findOne({
        where: { token: dto.token },
      });
      if (winner && winner.userId !== userId && winner.isActive) {
        throw new ForbiddenException(
          'FCM token đang được liên kết với một tài khoản khác. Hãy đăng xuất thiết bị khỏi tài khoản cũ trước.',
        );
      }
      throw error;
    }
    // notification_token is authoritative. Remove any legacy fallback that
    // could otherwise keep a token attached to a former account.
    await this.userRepo.update({ fcmToken: dto.token }, { fcmToken: null });
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
   * Lấy danh sách active tokens của user. The legacy User.fcmToken field is
   * deliberately not used: it lacks per-device ownership and may be stale.
   */
  async getActiveTokens(userId: string): Promise<string[]> {
    const tokens = await this.tokenRepo.find({
      where: { userId, isActive: true },
    });

    const activeList = tokens.map((t) => t.token);

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
