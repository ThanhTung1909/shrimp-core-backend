import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PondsService } from './ponds.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreatePondDto } from './dto/create-pond.dto.js';
import { UpdatePondDto } from './dto/update-pond.dto.js';
import { FindPondsQueryDto } from './dto/find-ponds-query.dto.js';
import { CreateThresholdConfigDto } from './dto/create-threshold-config.dto.js';
import { UpdateThresholdConfigDto } from './dto/update-threshold-config.dto.js';
import { CreateManualTestLogDto } from './dto/create-manual-test-log.dto.js';
import { UpdateManualTestLogDto } from './dto/update-manual-test-log.dto.js';
import { FindManualTestLogsQueryDto } from './dto/find-manual-test-logs-query.dto.js';
import { Pond } from './entities/pond.entity.js';
import { ThresholdConfig } from './entities/threshold-config.entity.js';
import { ManualTestLog } from './entities/manual-test-log.entity.js';
import {
  MessageOnlyResponse,
  MessageResponse,
  PaginatedResponse,
  ThresholdResponse,
} from './dto/pond-response.dto.js';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Ponds - Ao Nuôi & Ngưỡng Chỉ Số & Đo Thủ Công')
@ApiBearerAuth('JWT-auth')
@Controller('ponds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PondsController {
  constructor(private readonly pondsService: PondsService) {}

  // ==========================================
  // 1. POND ENDPOINTS
  // ==========================================

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Quản trị viên tạo ao nuôi mới' })
  @ApiResponse({ status: 201, description: 'Tạo ao nuôi thành công' })
  @ApiResponse({ status: 409, description: 'Tên ao nuôi đã tồn tại' })
  async createPond(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() createPondDto: CreatePondDto,
  ): Promise<MessageResponse<Pond>> {
    const pond = await this.pondsService.createPond(
      createPondDto,
      userId,
      role,
    );
    return {
      message: 'Tạo ao nuôi thành công!',
      data: pond,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách ao nuôi (Phân trang, Tìm kiếm, Lọc theo status)' })
  @ApiResponse({ status: 200, description: 'Danh sách ao nuôi phân trang' })
  async findAllPonds(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Query() query: FindPondsQueryDto,
  ): Promise<PaginatedResponse<Pond>> {
    return this.pondsService.findAllPonds(query, userId, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy thông tin chi tiết ao nuôi theo UUID' })
  @ApiResponse({ status: 200, description: 'Chi tiết ao nuôi' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy ao nuôi' })
  async findPondById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<Pond> {
    return this.pondsService.findPondById(pondId, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Quản trị viên cập nhật thông tin ao nuôi' })
  @ApiResponse({ status: 200, description: 'Cập nhật ao nuôi thành công' })
  async updatePond(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() updatePondDto: UpdatePondDto,
  ): Promise<MessageResponse<Pond>> {
    const pond = await this.pondsService.updatePond(
      pondId,
      updatePondDto,
      userId,
      role,
    );
    return {
      message: 'Cập nhật thông tin ao nuôi thành công!',
      data: pond,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete(':id')
  @ApiOperation({ summary: 'Quản trị viên xóa ao nuôi' })
  @ApiResponse({ status: 200, description: 'Xóa ao nuôi thành công' })
  async deletePond(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<MessageOnlyResponse> {
    return this.pondsService.deletePond(pondId, userId, role);
  }

  // ==========================================
  // 2. THRESHOLD CONFIG ENDPOINTS
  // ==========================================

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post(':pondId/thresholds')
  @ApiOperation({ summary: 'Thêm cấu hình ngưỡng chỉ số (pH, DO, Temp...) cho ao nuôi' })
  @ApiResponse({ status: 201, description: 'Tạo cấu hình ngưỡng thành công' })
  @ApiResponse({ status: 409, description: 'Cấu hình ngưỡng thông số này đã tồn tại trong ao' })
  async createThreshold(
    @Param('pondId', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateThresholdConfigDto,
  ): Promise<MessageResponse<ThresholdConfig>> {
    const config = await this.pondsService.createThresholdConfig(
      pondId,
      dto,
      userId,
      role,
    );
    return {
      message: 'Thêm cấu hình ngưỡng cảnh báo thành công!',
      data: config,
    };
  }

  @Get(':pondId/thresholds')
  @ApiOperation({ summary: 'Lấy danh sách cấu hình ngưỡng cảnh báo của một ao nuôi' })
  @ApiResponse({ status: 200, description: 'Danh sách cấu hình ngưỡng' })
  async findThresholdsByPond(
    @Param('pondId', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<ThresholdResponse[]> {
    return this.pondsService.findThresholdsByPond(pondId, userId, role);
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch('thresholds/:configId')
  @ApiOperation({ summary: 'Cập nhật khoảng giá trị min/max ngưỡng cảnh báo' })
  @ApiResponse({ status: 200, description: 'Cập nhật ngưỡng thành công' })
  async updateThreshold(
    @Param('configId', new ParseUUIDPipe({ version: '4' })) configId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateThresholdConfigDto,
  ): Promise<MessageResponse<ThresholdConfig>> {
    const config = await this.pondsService.updateThresholdConfig(
      configId,
      dto,
      userId,
      role,
    );
    return {
      message: 'Cập nhật cấu hình ngưỡng cảnh báo thành công!',
      data: config,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete('thresholds/:configId')
  @ApiOperation({ summary: 'Xóa cấu hình ngưỡng cảnh báo' })
  @ApiResponse({ status: 200, description: 'Xóa cấu hình ngưỡng thành công' })
  async deleteThreshold(
    @Param('configId', new ParseUUIDPipe({ version: '4' })) configId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<MessageOnlyResponse> {
    return this.pondsService.deleteThresholdConfig(configId, userId, role);
  }

  // ==========================================
  // 3. MANUAL TEST LOG ENDPOINTS
  // ==========================================

  @Post(':pondId/manual-logs')
  @ApiOperation({ summary: 'Ghi nhận nhật ký đo chất lượng nước thủ công (NH3, NO2,...)' })
  @ApiResponse({ status: 201, description: 'Ghi nhật ký thành công' })
  async createManualLog(
    @Param('pondId', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateManualTestLogDto,
  ): Promise<MessageResponse<ManualTestLog>> {
    const log = await this.pondsService.createManualTestLog(
      pondId,
      dto,
      userId,
      role,
    );
    return {
      message: 'Ghi nhận kết quả đo thủ công thành công!',
      data: log,
    };
  }

  @Get(':pondId/manual-logs')
  @ApiOperation({ summary: 'Lấy danh sách nhật ký đo thủ công theo ao nuôi (Có phân trang & Lọc thời gian)' })
  @ApiResponse({ status: 200, description: 'Danh sách bản ghi đo thủ công' })
  async findManualLogsByPond(
    @Param('pondId', new ParseUUIDPipe({ version: '4' })) pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Query() query: FindManualTestLogsQueryDto,
  ): Promise<PaginatedResponse<ManualTestLog>> {
    return this.pondsService.findManualLogsByPond(pondId, query, userId, role);
  }

  @Get('manual-logs/:logId')
  @ApiOperation({ summary: 'Lấy chi tiết một bản ghi đo thủ công theo UUID' })
  @ApiResponse({ status: 200, description: 'Chi tiết bản ghi đo thủ công' })
  async findManualLogById(
    @Param('logId', new ParseUUIDPipe({ version: '4' })) logId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<ManualTestLog> {
    return this.pondsService.findManualLogById(logId, userId, role);
  }

  @Patch('manual-logs/:logId')
  @ApiOperation({ summary: 'Cập nhật bản ghi đo thủ công' })
  @ApiResponse({ status: 200, description: 'Cập nhật bản ghi thành công' })
  async updateManualLog(
    @Param('logId', new ParseUUIDPipe({ version: '4' })) logId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateManualTestLogDto,
  ): Promise<MessageResponse<ManualTestLog>> {
    const log = await this.pondsService.updateManualTestLog(
      logId,
      dto,
      userId,
      role,
    );
    return {
      message: 'Cập nhật bản ghi đo thủ công thành công!',
      data: log,
    };
  }

  @Delete('manual-logs/:logId')
  @ApiOperation({ summary: 'Xóa bản ghi đo thủ công' })
  @ApiResponse({ status: 200, description: 'Xóa bản ghi thành công' })
  async deleteManualLog(
    @Param('logId', new ParseUUIDPipe({ version: '4' })) logId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ): Promise<MessageOnlyResponse> {
    return this.pondsService.deleteManualTestLog(logId, userId, role);
  }
}
