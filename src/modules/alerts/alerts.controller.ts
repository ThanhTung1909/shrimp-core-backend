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

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * Lấy danh sách toàn bộ cảnh báo (có phân trang và lọc)
   * GET /alerts
   */
  @Get()
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
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlertDto,
  ) {
    // Tạm thời truyền hard-code userId do hệ thống auth chưa được đề cập
    // Khi có auth, lấy userId từ req.user
    const mockUserId = '00000000-0000-0000-0000-000000000000'; 
    const result = await this.alertsService.resolveAlert(id, mockUserId, dto);

    return {
      success: true,
      data: result,
    };
  }
}
