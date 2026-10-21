import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreateCropDto, CreateHarvestDto, FindCropsQueryDto, UpdateCropDto, UpdateCropStatusDto } from './dto/crop.dto.js';
import { CropsService } from './crops.service.js';
@ApiTags('Crops - Vụ nuôi & Thu hoạch') @ApiBearerAuth('JWT-auth') @UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CropsController {
  constructor(private readonly service: CropsService) {}
  @Post('crops') create(@Body() dto: CreateCropDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.create(dto, id, role); }
  @Get('crops') all(@Query() q: FindCropsQueryDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.findAll(q, id, role); }
  @Get('ponds/:pondId/crops') byPond(@Param('pondId', ParseUUIDPipe) pondId: string, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.findByPond(pondId, id, role); }
  @Get('crops/:batchId/density') density(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.density(batchId, id, role); }
  @Post('crops/:batchId/harvests') harvest(@Param('batchId', ParseUUIDPipe) batchId: string, @Body() dto: CreateHarvestDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.createHarvest(batchId, dto, id, role); }
  @Get('crops/:batchId/harvests') harvests(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.listHarvests(batchId, id, role); }
  @Get('crops/:batchId/harvest-summary') summary(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.harvestSummary(batchId, id, role); }
  @Patch('crops/:batchId/status') status(@Param('batchId', ParseUUIDPipe) batchId: string, @Body() dto: UpdateCropStatusDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.changeStatus(batchId, dto.status, id, role); }
  @Get('crops/:batchId') one(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.findOne(batchId, id, role); }
  @Patch('crops/:batchId') update(@Param('batchId', ParseUUIDPipe) batchId: string, @Body() dto: UpdateCropDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.update(batchId, dto, id, role); }
  @Delete('crops/:batchId') remove(@Param('batchId', ParseUUIDPipe) batchId: string, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.remove(batchId, id, role); }
}
