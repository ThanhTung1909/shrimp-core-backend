import { ForbiddenException, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator.js';
import { Role } from '../../common/enums/role.enum.js';
import { PredictionType } from '../../common/enums/prediction-type.enum.js';
import { RiskLevel } from '../../common/enums/risk-level.enum.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PredictionsController } from './predictions.controller.js';
import { PredictionsService } from './predictions.service.js';
import { PredictionSchedulerService } from './prediction-scheduler.service.js';
import { QueryWaterQualityForecastDto } from './dto/query-water-quality-forecast.dto.js';
import { QueryDiseaseRiskDto } from './dto/query-disease-risk.dto.js';

describe('PredictionsController', () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const createContext = (handler: Function, role: Role): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => PredictionsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as ExecutionContext;

  describe('RBAC & route metadata', () => {
    const controller = new PredictionsController(
      {} as PredictionsService,
      {} as PredictionSchedulerService,
    );
    const rolesGuard = new RolesGuard(new Reflector());

    it('preserves ADMIN and MANAGER restriction on trigger endpoints', () => {
      for (const handler of [controller.triggerPondPrediction, controller.triggerActivePondsNow]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.ADMIN, Role.MANAGER]);
        expect(rolesGuard.canActivate(createContext(handler, Role.ADMIN))).toBe(true);
        expect(rolesGuard.canActivate(createContext(handler, Role.MANAGER))).toBe(true);
        expect(() => rolesGuard.canActivate(createContext(handler, Role.FARMER))).toThrow(
          ForbiddenException,
        );
      }
    });

    it('allows FARMER, MANAGER, ADMIN through RolesGuard on read prediction endpoints', () => {
      for (const handler of [
        controller.getLatestPrediction,
        controller.getPredictionHistory,
        controller.getWaterQualityForecast,
        controller.getDiseaseRiskAssessment,
      ]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
        expect(rolesGuard.canActivate(createContext(handler, Role.FARMER))).toBe(true);
        expect(rolesGuard.canActivate(createContext(handler, Role.MANAGER))).toBe(true);
        expect(rolesGuard.canActivate(createContext(handler, Role.ADMIN))).toBe(true);
      }
    });

    it('defines ResponseMessage metadata on new P2-1 GET endpoints', () => {
      expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, controller.getWaterQualityForecast)).toBe(
        'Lấy dự báo chất lượng nước thành công',
      );
      expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, controller.getDiseaseRiskAssessment)).toBe(
        'Đánh giá rủi ro dịch bệnh thành công',
      );
    });
  });

  describe('Query DTO validation and boolean transform under enableImplicitConversion', () => {
    it('transforms refresh="false" to false and refresh="true" to true on QueryWaterQualityForecastDto', async () => {
      const defaultDto = await validationPipe.transform(
        {},
        { type: 'query', metatype: QueryWaterQualityForecastDto },
      );
      expect(defaultDto).toMatchObject({ horizonHours: 24, stepHours: 1, refresh: false });

      const falseDto = await validationPipe.transform(
        { refresh: 'false', horizonHours: '12', stepHours: '3' },
        { type: 'query', metatype: QueryWaterQualityForecastDto },
      );
      expect(falseDto).toMatchObject({ horizonHours: 12, stepHours: 3, refresh: false });
      expect(falseDto.refresh).toBe(false);

      const trueDto = await validationPipe.transform(
        { refresh: 'true', horizonHours: '24', stepHours: '6' },
        { type: 'query', metatype: QueryWaterQualityForecastDto },
      );
      expect(trueDto).toMatchObject({ horizonHours: 24, stepHours: 6, refresh: true });
      expect(trueDto.refresh).toBe(true);
    });

    it('validates horizonHours (12..24) and stepHours ([1,2,3,4,6]) bounds', async () => {
      await expect(
        validationPipe.transform(
          { horizonHours: '11' },
          { type: 'query', metatype: QueryWaterQualityForecastDto },
        ),
      ).rejects.toThrow();

      await expect(
        validationPipe.transform(
          { horizonHours: '25' },
          { type: 'query', metatype: QueryWaterQualityForecastDto },
        ),
      ).rejects.toThrow();

      await expect(
        validationPipe.transform(
          { stepHours: '5' },
          { type: 'query', metatype: QueryWaterQualityForecastDto },
        ),
      ).rejects.toThrow();

      await expect(
        validationPipe.transform(
          { refresh: 'invalid' },
          { type: 'query', metatype: QueryWaterQualityForecastDto },
        ),
      ).rejects.toThrow();
    });

    it('transforms refresh="false" vs "true" on QueryDiseaseRiskDto', async () => {
      const defaultDto = await validationPipe.transform(
        {},
        { type: 'query', metatype: QueryDiseaseRiskDto },
      );
      expect(defaultDto.refresh).toBe(false);

      const falseDto = await validationPipe.transform(
        { refresh: 'false' },
        { type: 'query', metatype: QueryDiseaseRiskDto },
      );
      expect(falseDto.refresh).toBe(false);

      const trueDto = await validationPipe.transform(
        { refresh: 'true' },
        { type: 'query', metatype: QueryDiseaseRiskDto },
      );
      expect(trueDto.refresh).toBe(true);

      await expect(
        validationPipe.transform(
          { refresh: 'nope' },
          { type: 'query', metatype: QueryDiseaseRiskDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('Service delegation & response shape', () => {
    const pondId = '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb';

    it('delegates getWaterQualityForecast with pondId, query, userId, role and omits top-level message', async () => {
      const mockResponse = {
        predictionId: 'pred-wq-1',
        pondId,
        predictionType: PredictionType.WATER_QUALITY,
        generatedAt: '2026-11-22T02:00:00.000Z',
        predictedTime: '2026-11-23T02:00:00.000Z',
        horizonHours: 24,
        stepHours: 1,
        cached: false,
        isFallback: false,
        predictionSource: 'AI_MICROSERVICE',
        riskScore: 0.25,
        riskLevel: RiskLevel.LOW,
        currentMetrics: {
          currentDO: 5.2,
          currentPH: 7.7,
          currentTemp: 28.5,
          salinity: 15,
          turbidity: 20,
          recordedAt: '2026-11-22T01:55:00.000Z',
        },
        summary: {
          minDO: 4.5,
          maxDO: 5.6,
          avgDO: 5.0,
          minPH: 7.6,
          maxPH: 7.9,
          minTemperature: 27.5,
          maxTemperature: 29.2,
          peakRiskScore: 0.25,
          peakRiskOffsetHours: 16,
          peakRiskTime: '2026-11-22T18:00:00.000Z',
        },
        series: [],
        factors: [],
        recommendations: [],
      };
      const mockService = {
        getWaterQualityForecast: vi.fn().mockResolvedValue(mockResponse),
      } as unknown as PredictionsService;

      const controller = new PredictionsController(mockService, {} as PredictionSchedulerService);
      const query: QueryWaterQualityForecastDto = { horizonHours: 24, stepHours: 1, refresh: false };

      const result = await controller.getWaterQualityForecast(pondId, query, 'user-1', Role.FARMER);

      expect(mockService.getWaterQualityForecast).toHaveBeenCalledWith(
        pondId,
        query,
        'user-1',
        Role.FARMER,
      );
      expect(result).toEqual(mockResponse);
      expect(result).not.toHaveProperty('message');
    });

    it('delegates getDiseaseRiskAssessment with pondId, query, userId, role and omits top-level message', async () => {
      const mockResponse = {
        predictionId: 'pred-dr-1',
        pondId,
        predictionType: PredictionType.DISEASE_RISK,
        assessedAt: '2026-11-22T02:00:00.000Z',
        validUntil: '2026-11-23T02:00:00.000Z',
        cached: false,
        isFallback: true,
        predictionSource: 'HEURISTIC_RULE',
        overallRiskScore: 0.42,
        overallRiskLevel: RiskLevel.MEDIUM,
        diseases: [],
        inputSnapshot: {},
        recommendations: [],
      };
      const mockService = {
        getDiseaseRiskAssessment: vi.fn().mockResolvedValue(mockResponse),
      } as unknown as PredictionsService;

      const controller = new PredictionsController(mockService, {} as PredictionSchedulerService);
      const query: QueryDiseaseRiskDto = { refresh: true };

      const result = await controller.getDiseaseRiskAssessment(pondId, query, 'user-2', Role.MANAGER);

      expect(mockService.getDiseaseRiskAssessment).toHaveBeenCalledWith(
        pondId,
        query,
        'user-2',
        Role.MANAGER,
      );
      expect(result).toEqual(mockResponse);
      expect(result).not.toHaveProperty('message');
    });
  });
});
