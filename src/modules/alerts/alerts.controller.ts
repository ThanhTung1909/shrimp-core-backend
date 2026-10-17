import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AlertsService } from './alerts.service.js';
import { QueryAlertDto } from './dto/query-alert.dto.js';
import { ResolveAlertDto } from './dto/resolve-alert.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { User } from '../users/entities/user.entity.js';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Alerts - Cảnh Báo Vi Phạm & Nguy Cơ')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) { }

  /**
   * Lấy danh sách toàn bộ cảnh báo (có phân trang và lọc)
   * GET /alerts
   */
  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách cảnh báo theo quyền người dùng',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách cảnh báo phân trang',
  })
  async findAll(
    @Query() query: QueryAlertDto,
    @CurrentUser() currentUser: User,
  ) {
    const { data, total } = await this.alertsService.findAll(
      query,
      currentUser.userId,
      currentUser.role,
    );

    return {
      success: true,
      total,
      page: query.page || 1,
      limit: query.limit || 20,
      data,
    };
  }

  /**
   * Đánh dấu đã xử lý/khắc phục xong một cảnh báo cụ thể
   * PATCH /alerts/:id/resolve
   */
  @Patch(':id/resolve')
  @ApiOperation({
    summary: 'Xác nhận và đánh dấu đã xử lý cảnh báo',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã giải quyết cảnh báo thành công',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy cảnh báo',
  })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
    @CurrentUser() currentUser: User,
  ) {
    const result = await this.alertsService.resolveAlert(
      id,
      currentUser.userId,
      dto,
      currentUser.role,
    );

    return {
      success: true,
      data: result,
    };
  }
}
