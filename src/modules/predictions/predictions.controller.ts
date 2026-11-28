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
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PredictionsService } from './predictions.service.js';
import { PredictionSchedulerService } from './prediction-scheduler.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { AiPrediction } from './entities/ai-prediction.entity.js';
import { QueryWaterQualityForecastDto } from './dto/query-water-quality-forecast.dto.js';
import { QueryDiseaseRiskDto } from './dto/query-disease-risk.dto.js';
import {
  DiseaseRiskResponseDto,
  WaterQualityForecastResponseDto,
} from './dto/prediction-response.dto.js';

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
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<AiPrediction> {
    const latest = await this.predictionsService.getLatestPrediction(pondId, userId, role);
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
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<AiPrediction[]> {
    return this.predictionsService.getPredictionHistory(pondId, Number(limit) || 20, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('pond/:pondId/trigger')
  @ApiOperation({ summary: 'Kích hoạt ngay tác vụ dự báo AI cho một ao nuôi cụ thể' })
  @ApiResponse({ status: 201, description: 'Dự báo thành công' })
  async triggerPondPrediction(
    @Param('pondId', ParseUUIDPipe) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<AiPrediction> {
    return this.predictionsService.predictForPond(pondId, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('trigger-active')
  @ApiOperation({ summary: 'Kích hoạt thủ công chạy dự báo cho toàn bộ các ao active' })
  @ApiResponse({ status: 200, description: 'Đã enqueue job chạy dự báo cho các ao active' })
  async triggerActivePondsNow(): Promise<{ message: string }> {
    await this.schedulerService.triggerActivePondsNow();
    return { message: 'Đã đưa tác vụ tính toán AI các ao active vào hàng đợi BullMQ' };
  }

  @Get('ponds/:pondId/water-quality')
  @ResponseMessage('Lấy dự báo chất lượng nước thành công')
  @ApiOperation({ summary: 'Dự báo chất lượng nước đa khung giờ (12h - 24h) cho một ao nuôi' })
  @ApiParam({ name: 'pondId', type: String, format: 'uuid', description: 'ID của ao nuôi' })
  @ApiResponse({
    status: 200,
    description: 'Kết quả dự báo chất lượng nước đa khung giờ',
    type: WaterQualityForecastResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Không có quyền truy cập ao nuôi này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy ao nuôi' })
  async getWaterQualityForecast(
    @Param('pondId', ParseUUIDPipe) pondId: string,
    @Query() query: QueryWaterQualityForecastDto,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<WaterQualityForecastResponseDto> {
    return this.predictionsService.getWaterQualityForecast(pondId, query, userId, role);
  }

  @Get('ponds/:pondId/disease-risk')
  @ResponseMessage('Đánh giá rủi ro dịch bệnh thành công')
  @ApiOperation({ summary: 'Đánh giá rủi ro dịch bệnh (WSSV & AHPND/EMS) cho một ao nuôi' })
  @ApiParam({ name: 'pondId', type: String, format: 'uuid', description: 'ID của ao nuôi' })
  @ApiResponse({
    status: 200,
    description: 'Kết quả đánh giá rủi ro dịch bệnh',
    type: DiseaseRiskResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Không có quyền truy cập ao nuôi này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy ao nuôi' })
  async getDiseaseRiskAssessment(
    @Param('pondId', ParseUUIDPipe) pondId: string,
    @Query() query: QueryDiseaseRiskDto,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<DiseaseRiskResponseDto> {
    return this.predictionsService.getDiseaseRiskAssessment(pondId, query, userId, role);
  }
}
