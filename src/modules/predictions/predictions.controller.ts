import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PredictionsService } from './predictions.service.js';
import { PredictionSchedulerService } from './prediction-scheduler.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { AiPrediction } from './entities/ai-prediction.entity.js';

@ApiTags('Predictions - Dự Báo AI & Đánh Giá Rủi Ro')
@ApiBearerAuth('JWT-auth')
@Controller('predictions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PredictionsController {
  constructor(
    private readonly predictionsService: PredictionsService,
    private readonly schedulerService: PredictionSchedulerService,
  ) {}

  @Get('pond/:pondId/latest')
  @ApiOperation({ summary: 'Lấy bản ghi dự báo AI mới nhất của một ao nuôi' })
  @ApiResponse({ status: 200, description: 'Bản ghi dự báo mới nhất' })
  @ApiResponse({ status: 404, description: 'Chưa có dữ liệu dự báo cho ao nuôi này' })
  async getLatestPrediction(
    @Param('pondId', ParseUUIDPipe) pondId: string,
  ): Promise<AiPrediction> {
    const latest = await this.predictionsService.getLatestPrediction(pondId);
    if (!latest) {
      throw new NotFoundException(`Chưa có dữ liệu dự báo cho ao nuôi ID: ${pondId}`);
    }
    return latest;
  }

  @Get('pond/:pondId/history')
  @ApiOperation({ summary: 'Lấy lịch sử dự báo chất lượng nước của ao nuôi' })
  @ApiResponse({ status: 200, description: 'Danh sách các bản ghi dự báo' })
  async getPredictionHistory(
    @Param('pondId', ParseUUIDPipe) pondId: string,
    @Query('limit') limit = 20,
  ): Promise<AiPrediction[]> {
    return this.predictionsService.getPredictionHistory(pondId, Number(limit) || 20);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('pond/:pondId/trigger')
  @ApiOperation({ summary: 'Kích hoạt ngay tác vụ dự báo AI cho một ao nuôi cụ thể' })
  @ApiResponse({ status: 201, description: 'Dự báo thành công' })
  async triggerPondPrediction(
    @Param('pondId', ParseUUIDPipe) pondId: string,
  ): Promise<AiPrediction> {
    return this.predictionsService.predictForPond(pondId);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('trigger-active')
  @ApiOperation({ summary: 'Kích hoạt thủ công chạy dự báo cho toàn bộ các ao active' })
  @ApiResponse({ status: 200, description: 'Đã enqueue job chạy dự báo cho các ao active' })
  async triggerActivePondsNow(): Promise<{ message: string }> {
    await this.schedulerService.triggerActivePondsNow();
    return { message: 'Đã đưa tác vụ tính toán AI các ao active vào hàng đợi BullMQ' };
  }
}
