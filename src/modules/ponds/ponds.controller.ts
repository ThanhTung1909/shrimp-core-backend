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
} from '@nestjs/common';
import { PondsService } from './ponds.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreatePondDto } from './dto/create-pond.dto.js';
import { UpdatePondDto } from './dto/update-pond.dto.js';
import { FindPondsQueryDto } from './dto/find-ponds-query.dto.js';
import { CreateThresholdConfigDto } from './dto/create-threshold-config.dto.js';
import { UpdateThresholdConfigDto } from './dto/update-threshold-config.dto.js';
import { CreateManualTestLogDto } from './dto/create-manual-test-log.dto.js';
import { UpdateManualTestLogDto } from './dto/update-manual-test-log.dto.js';
import { FindManualTestLogsQueryDto } from './dto/find-manual-test-logs-query.dto.js';

@Controller('ponds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PondsController {
  constructor(private readonly pondsService: PondsService) {}

  // ==========================================
  // 1. POND ENDPOINTS
  // ==========================================

  @Post()
  async createPond(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() createPondDto: CreatePondDto,
  ) {
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
  async findAllPonds(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Query() query: FindPondsQueryDto,
  ) {
    return this.pondsService.findAllPonds(query, userId, role);
  }

  @Get(':id')
  async findPondById(
    @Param('id') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.pondsService.findPondById(pondId, userId, role);
  }

  @Patch(':id')
  async updatePond(
    @Param('id') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() updatePondDto: UpdatePondDto,
  ) {
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

  @Delete(':id')
  async deletePond(
    @Param('id') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.pondsService.deletePond(pondId, userId, role);
  }

  // ==========================================
  // 2. THRESHOLD CONFIG ENDPOINTS
  // ==========================================

  @Post(':pondId/thresholds')
  async createThreshold(
    @Param('pondId') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateThresholdConfigDto,
  ) {
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
  async findThresholdsByPond(
    @Param('pondId') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.pondsService.findThresholdsByPond(pondId, userId, role);
  }

  @Patch('thresholds/:configId')
  async updateThreshold(
    @Param('configId') configId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateThresholdConfigDto,
  ) {
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

  @Delete('thresholds/:configId')
  async deleteThreshold(
    @Param('configId') configId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.pondsService.deleteThresholdConfig(configId, userId, role);
  }

  // ==========================================
  // 3. MANUAL TEST LOG ENDPOINTS
  // ==========================================

  @Post(':pondId/manual-logs')
  async createManualLog(
    @Param('pondId') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateManualTestLogDto,
  ) {
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
  async findManualLogsByPond(
    @Param('pondId') pondId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Query() query: FindManualTestLogsQueryDto,
  ) {
    return this.pondsService.findManualLogsByPond(pondId, query, userId, role);
  }

  @Get('manual-logs/:logId')
  async findManualLogById(
    @Param('logId') logId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.pondsService.findManualLogById(logId, userId, role);
  }

  @Patch('manual-logs/:logId')
  async updateManualLog(
    @Param('logId') logId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateManualTestLogDto,
  ) {
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
  async deleteManualLog(
    @Param('logId') logId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.pondsService.deleteManualTestLog(logId, userId, role);
  }
}
