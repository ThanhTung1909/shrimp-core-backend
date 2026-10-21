import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Role } from '../../common/enums/role.enum.js';
import { CreateFarmDto, FindFarmsQueryDto, UpdateFarmDto } from './dto/farm.dto.js';
import { FarmsService } from './farms.service.js';
@ApiTags('Farms') @ApiBearerAuth('JWT-auth') @Controller('farms') @UseGuards(JwtAuthGuard, RolesGuard)
export class FarmsController {
  constructor(private readonly service: FarmsService) {}
  @Post() create(@Body() dto: CreateFarmDto, @CurrentUser('userId') userId: string) { return this.service.create(dto, userId); }
  @Get() findAll(@Query() query: FindFarmsQueryDto, @CurrentUser('userId') id: string, @CurrentUser('role') role: Role) { return this.service.findAll(query, id, role); }
  @Get(':farmId/ponds') ponds(@Param('farmId', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) { return this.service.findPonds(id, userId, role); }
  @Get(':farmId') findOne(@Param('farmId', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) { return this.service.findOne(id, userId, role); }
  @Patch(':farmId') update(@Param('farmId', ParseUUIDPipe) id: string, @Body() dto: UpdateFarmDto, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) { return this.service.update(id, dto, userId, role); }
  @Delete(':farmId') remove(@Param('farmId', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string, @CurrentUser('role') role: Role) { return this.service.remove(id, userId, role); }
}
