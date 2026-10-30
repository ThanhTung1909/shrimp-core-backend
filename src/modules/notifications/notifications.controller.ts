import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationTokensService } from './notification-tokens.service.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto.js';
import { UnregisterFcmTokenDto } from './dto/unregister-fcm-token.dto.js';
import { UpdatePreferencesDto } from './dto/update-preference.dto.js';
import { QueryNotificationHistoryDto } from './dto/query-history.dto.js';

@ApiTags('Notifications - Hệ Thống Cảnh Báo Đa Kênh')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
    private readonly tokensService: NotificationTokensService,
    private readonly dispatcherService: NotificationDispatcherService,
  ) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Lấy cấu hình nhận thông báo cảnh báo của người dùng hiện tại' })
  @ApiResponse({ status: 200, description: 'Danh sách cài đặt thông báo theo kênh và mức độ cảnh báo' })
  async getMyPreferences(@CurrentUser('userId') userId: string) {
    return this.preferencesService.getUserPreferences(userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Cập nhật cấu hình nhận thông báo (bật/tắt SMS, Email, FCM theo mức độ)' })
  @ApiResponse({ status: 200, description: 'Cài đặt thông báo đã được cập nhật thành công' })
  async updateMyPreferences(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.preferencesService.updatePreferences(userId, dto);
  }

  @Post('fcm-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng ký FCM Device Token để nhận Push Notification' })
  @ApiResponse({ status: 200, description: 'Đăng ký FCM token thành công' })
  async registerFcmToken(
    @CurrentUser('userId') userId: string,
    @Body() dto: RegisterFcmTokenDto,
  ) {
    const registered = await this.tokensService.registerToken(userId, dto);
    // A device token is a credential; acknowledgement must not echo it back.
    return {
      tokenId: registered.tokenId,
      platform: registered.platform,
      isActive: registered.isActive,
    };
  }

  @Delete('fcm-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hủy đăng ký FCM Device Token khi đăng xuất hoặc gỡ cài đặt' })
  @ApiResponse({ status: 200, description: 'Hủy đăng ký FCM token thành công' })
  async unregisterFcmToken(
    @CurrentUser('userId') userId: string,
    @Body() dto: UnregisterFcmTokenDto,
  ) {
    await this.tokensService.unregisterToken(userId, dto.token);
    return {
      message: 'Hủy đăng ký FCM token thành công',
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lấy lịch sử nhận thông báo cảnh báo của người dùng (phân trang)' })
  @ApiResponse({ status: 200, description: 'Lịch sử nhận thông báo phân trang' })
  async getHistory(
    @CurrentUser('userId') userId: string,
    @Query() query: QueryNotificationHistoryDto,
  ) {
    return this.dispatcherService.getDeliveryHistory(userId, query);
  }
}
