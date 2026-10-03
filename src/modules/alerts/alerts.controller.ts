import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AlertsService } from './alerts.service.js';
import { QueryAlertDto } from './dto/query-alert.dto.js';
import { ResolveAlertDto } from './dto/resolve-alert.dto.js';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Alerts - Cảnh Báo Vi Phạm & Nguy Cơ')
@ApiBearerAuth('JWT-auth')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * Lấy danh sách toàn bộ cảnh báo (có phân trang và lọc)
   * GET /alerts
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách các cảnh báo (Lọc theo deviceId, trạng thái ACTIVE/RESOLVED, phân trang)' })
  @ApiResponse({ status: 200, description: 'Danh sách cảnh báo phân trang' })
  async findAll(@Query() query: QueryAlertDto) {
    const { data, total } = await this.alertsService.findAll(query);

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
  @ApiOperation({ summary: 'Xác nhận và đánh dấu đã xử lý sự cố cảnh báo (Resolve alert + ghi chú)' })
  @ApiResponse({ status: 200, description: 'Đã giải quyết cảnh báo thành công' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy cảnh báo với ID được chỉ định' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
  ) {
    const mockUserId = '00000000-0000-0000-0000-000000000000';
    const result = await this.alertsService.resolveAlert(id, mockUserId, dto);

    return {
      success: true,
      data: result,
    };
  }
}
