import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TelemetryService } from './telemetry.service.js';
import { QueryTelemetryDto } from './dto/query-telemetry.dto.js';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Telemetry - Dữ Liệu Cảm Biến Chuỗi Thời Gian')
@ApiBearerAuth('JWT-auth')
@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Lấy chỉ số đo đạc mới nhất của thiết bị
   * GET /telemetry/device/:deviceId/latest
   */
  @Get('device/:deviceId/latest')
  @ApiOperation({ summary: 'Lấy bản ghi dữ liệu cảm biến mới nhất của một thiết bị IoT' })
  @ApiResponse({ status: 200, description: 'Trả về bản ghi cảm biến mới nhất' })
  @ApiResponse({ status: 404, description: 'Chưa có dữ liệu cảm biến cho thiết bị này' })
  async getLatest(@Param('deviceId', ParseUUIDPipe) deviceId: string) {
    const latest = await this.telemetryService.getLatestByDeviceId(deviceId);

    if (!latest) {
      throw new NotFoundException(
        `Không tìm thấy dữ liệu đo đạc cho thiết bị ID: ${deviceId}`,
      );
    }

    return {
      success: true,
      data: latest,
    };
  }

  /**
   * Lấy lịch sử chỉ số đo đạc của thiết bị (có phân trang và lọc theo thời gian)
   * GET /telemetry/device/:deviceId/history
   */
  @Get('device/:deviceId/history')
  @ApiOperation({ summary: 'Lấy lịch sử dữ liệu cảm biến theo khoảng thời gian (Lọc theo startDate, endDate, phân trang)' })
  @ApiResponse({ status: 200, description: 'Lịch sử cảm biến chuỗi thời gian' })
  async getHistory(
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query() query: QueryTelemetryDto,
  ) {
    const { data, total } = await this.telemetryService.getHistoryByDeviceId(
      deviceId,
      query,
    );

    return {
      success: true,
      total,
      page: query.page || 1,
      limit: query.limit || 100,
      data,
    };
  }
}
