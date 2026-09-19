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

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Lấy chỉ số đo đạc mới nhất của thiết bị
   * GET /telemetry/device/:deviceId/latest
   */
  @Get('device/:deviceId/latest')
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
