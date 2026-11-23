import { describe, expect, it } from 'vitest';
import { RiskLevel } from '../../../common/enums/risk-level.enum.js';
import {
  buildAiPredictionRequest,
  buildDiseaseRiskRequest,
  buildWaterQualityForecastRequest,
  mapAiPredictionResponse,
  mapDiseaseRiskResponse,
  mapWaterQualityForecastResponse,
} from './ai-prediction.mapper.js';

describe('AI prediction contract mapper', () => {
  const validRequest = {
    pondId: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb',
    currentDO: 5.2,
    currentPH: 7.7,
    currentTemp: 28.5,
    salinity: 15,
    turbidity: 20,
    timestamp: '2026-11-16T00:00:00.000Z',
  };

  it.each([
    ['SAFE', 0, RiskLevel.LOW, 0],
    ['SAFE', 25, RiskLevel.LOW, 0.25],
    ['WARNING', 50, RiskLevel.MEDIUM, 0.5],
    ['DANGER', 75, RiskLevel.HIGH, 0.75],
    ['DANGER', 100, RiskLevel.HIGH, 1],
  ])('maps %s/%i into domain %s/%f without double normalization', (externalLevel, externalScore, riskLevel, riskScore) => {
    expect(mapAiPredictionResponse({
      predictedDO: 4.8,
      predictedPH: 7.6,
      riskScore: externalScore,
      riskLevel: externalLevel,
    })).toEqual({
      ok: true,
      value: {
        predictedDO: 4.8,
        predictedPH: 7.6,
        riskScore,
        riskLevel,
      },
    });
  });

  it.each([
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: null, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: -1, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: 101, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: Number.NaN, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: Number.POSITIVE_INFINITY, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: '25', riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: 25, riskLevel: 'LOW' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: 25, riskLevel: null }],
    [{ predictedDO: Number.NaN, predictedPH: 7.6, riskScore: 25, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: Number.POSITIVE_INFINITY, riskScore: 25, riskLevel: 'SAFE' }],
    [{ predictedDO: 4.8, predictedPH: 7.6, riskScore: 25 }],
    [null],
  ])('rejects an invalid external response: %o', (payload) => {
    expect(mapAiPredictionResponse(payload)).toMatchObject({ ok: false });
  });

  it('builds the complete request schema expected by FastAPI', () => {
    expect(buildAiPredictionRequest(validRequest)).toEqual({ ok: true, value: validRequest });
  });

  it('does not restrict a canonical UUID to legacy UUID versions', () => {
    const uuidV7Request = { ...validRequest, pondId: '018f0a5c-fd55-7f2a-9d33-a8dc439af556' };
    expect(buildAiPredictionRequest(uuidV7Request)).toEqual({ ok: true, value: uuidV7Request });
  });

  it.each([
    ['salinity', { ...validRequest, salinity: undefined }],
    ['turbidity', { ...validRequest, turbidity: undefined }],
    ['temperature', { ...validRequest, currentTemp: undefined }],
    ['timestamp', { ...validRequest, timestamp: undefined }],
    ['timezone-free timestamp', { ...validRequest, timestamp: '2026-11-16T00:00:00' }],
    ['invalid UUID', { ...validRequest, pondId: 'pond-1' }],
    ['negative DO', { ...validRequest, currentDO: -0.01 }],
    ['NaN salinity', { ...validRequest, salinity: Number.NaN }],
    ['infinite turbidity', { ...validRequest, turbidity: Number.POSITIVE_INFINITY }],
  ])('rejects a FastAPI-invalid request (%s) before HTTP', (_scenario, payload) => {
    expect(buildAiPredictionRequest(payload)).toMatchObject({ ok: false });
  });

  describe('water quality forecast contract mapper', () => {
    const validWqRequest = {
      pondId: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb',
      horizonHours: 24,
      stepHours: 6,
      timestamp: '2026-11-22T02:00:00.000Z',
      currentMetrics: {
        currentDO: 5.2,
        currentPH: 7.7,
        currentTemp: 28.5,
        salinity: 15,
        turbidity: 20,
      },
      recentHistory: [
        {
          recordedAt: '2026-11-22T01:00:00.000Z',
          dissolvedOxygen: 5.4,
          ph: 7.8,
          temperature: 28.6,
        },
      ],
      pondProfile: {
        areaM2: 1000,
        depthM: 1.5,
        shrimpDensity: 120,
        shrimpSpecies: 'Litopenaeus vannamei',
        daysOfCulture: 35,
      },
    };

    it('builds a valid multi-horizon water quality forecast request', () => {
      expect(buildWaterQualityForecastRequest(validWqRequest)).toEqual({
        ok: true,
        value: validWqRequest,
      });
    });

    it.each([
      ['invalid pondId', { ...validWqRequest, pondId: 'not-uuid' }],
      ['horizonHours < 12', { ...validWqRequest, horizonHours: 11 }],
      ['horizonHours > 24', { ...validWqRequest, horizonHours: 25 }],
      ['non-integer horizonHours', { ...validWqRequest, horizonHours: 18.5 }],
      ['invalid stepHours', { ...validWqRequest, stepHours: 5 }],
      ['timezone-free timestamp', { ...validWqRequest, timestamp: '2026-11-22T02:00:00' }],
      ['missing currentMetrics', { ...validWqRequest, currentMetrics: null }],
      [
        'missing salinity',
        { ...validWqRequest, currentMetrics: { ...validWqRequest.currentMetrics, salinity: undefined } },
      ],
      [
        'out-of-range temp',
        { ...validWqRequest, currentMetrics: { ...validWqRequest.currentMetrics, currentTemp: 55 } },
      ],
    ])('rejects invalid water quality forecast request (%s)', (_scenario, payload) => {
      expect(buildWaterQualityForecastRequest(payload)).toMatchObject({ ok: false });
    });

    it('maps a valid water quality forecast response and normalizes scores 0..100 once', () => {
      const mapped = mapWaterQualityForecastResponse({
        overallRiskScore: 42,
        overallRiskLevel: 'WARNING',
        series: [
          {
            offsetHours: 6,
            predictedTime: '2026-11-22T08:00:00.000Z',
            predictedDO: 4.3,
            predictedPH: 7.6,
            predictedTemperature: 29.1,
            riskScore: 30,
            riskLevel: 'SAFE',
          },
          {
            offsetHours: 12,
            predictedTime: '2026-11-22T14:00:00.000Z',
            predictedDO: 3.9,
            predictedPH: 7.5,
            predictedTemperature: 30.2,
            riskScore: 42,
            riskLevel: 'WARNING',
          },
        ],
        factors: ['Night respiration drop'],
        recommendations: ['Increase aeration'],
      });

      expect(mapped).toEqual({
        ok: true,
        value: {
          overallRiskScore: 0.42,
          overallRiskLevel: RiskLevel.MEDIUM,
          series: [
            {
              offsetHours: 6,
              predictedTime: '2026-11-22T08:00:00.000Z',
              predictedDO: 4.3,
              predictedPH: 7.6,
              predictedTemperature: 29.1,
              riskScore: 0.3,
              riskLevel: RiskLevel.LOW,
            },
            {
              offsetHours: 12,
              predictedTime: '2026-11-22T14:00:00.000Z',
              predictedDO: 3.9,
              predictedPH: 7.5,
              predictedTemperature: 30.2,
              riskScore: 0.42,
              riskLevel: RiskLevel.MEDIUM,
            },
          ],
          factors: ['Night respiration drop'],
          recommendations: ['Increase aeration'],
        },
      });
    });

    it('normalizes omitted or null optional arrays to empty arrays', () => {
      const mapped = mapWaterQualityForecastResponse({
        overallRiskScore: 10,
        overallRiskLevel: 'SAFE',
        series: [
          {
            offsetHours: 1,
            predictedTime: '2026-11-22T03:00:00+00:00',
            predictedDO: 5.1,
            predictedPH: 7.7,
            predictedTemperature: 28.4,
            riskScore: 10,
            riskLevel: 'SAFE',
          },
        ],
        factors: null,
      });

      expect(mapped).toMatchObject({
        ok: true,
        value: {
          factors: [],
          recommendations: [],
        },
      });
    });

    const validPoint = {
      offsetHours: 1,
      predictedTime: '2026-11-22T03:00:00.000Z',
      predictedDO: 4.8,
      predictedPH: 7.6,
      predictedTemperature: 28.5,
      riskScore: 25,
      riskLevel: 'SAFE',
    };

    it.each([
      [null],
      [{ overallRiskScore: 101, overallRiskLevel: 'SAFE', series: [validPoint] }],
      [{ overallRiskScore: -1, overallRiskLevel: 'SAFE', series: [validPoint] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'LOW', series: [validPoint] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'SAFE', series: [] }],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          series: [{ ...validPoint, offsetHours: 0 }],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          series: [{ ...validPoint, predictedTime: 'invalid-date' }],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          series: [{ ...validPoint, predictedTemperature: Number.NaN }],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          series: [{ ...validPoint, riskScore: 105 }],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          series: [{ ...validPoint, riskLevel: 'MEDIUM' }],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          series: [validPoint],
          factors: [123],
        },
      ],
    ])('rejects invalid water quality forecast response: %o', (payload) => {
      expect(mapWaterQualityForecastResponse(payload)).toMatchObject({ ok: false });
    });
  });

  describe('disease risk contract mapper', () => {
    const validDiseaseRequest = {
      pondId: '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb',
      timestamp: '2026-11-22T02:00:00.000Z',
      currentMetrics: {
        currentDO: 5.2,
        currentPH: 7.7,
        currentTemp: 28.5,
        salinity: 15,
        turbidity: 20,
        nh3: 0.03,
        no2: 0.2,
      },
      variability24h: {
        temperatureDelta: 2.1,
        phDelta: 0.3,
        minDO: 4.5,
        minTemp: 27.1,
        maxTemp: 29.2,
      },
      pondProfile: {
        areaM2: 1200,
        depthM: 1.4,
        shrimpDensity: 110,
        shrimpSpecies: 'Litopenaeus vannamei',
        daysOfCulture: 28,
      },
    };

    it('builds a valid disease risk request with optional NH3/NO2 and variability24h', () => {
      expect(buildDiseaseRiskRequest(validDiseaseRequest)).toEqual({
        ok: true,
        value: validDiseaseRequest,
      });
    });

    it.each([
      ['invalid pondId', { ...validDiseaseRequest, pondId: 'pond-1' }],
      ['timezone-free timestamp', { ...validDiseaseRequest, timestamp: '2026-11-22T02:00:00' }],
      [
        'missing currentPH',
        {
          ...validDiseaseRequest,
          currentMetrics: { ...validDiseaseRequest.currentMetrics, currentPH: undefined },
        },
      ],
      [
        'negative nh3',
        {
          ...validDiseaseRequest,
          currentMetrics: { ...validDiseaseRequest.currentMetrics, nh3: -0.01 },
        },
      ],
      [
        'out-of-range no2',
        {
          ...validDiseaseRequest,
          currentMetrics: { ...validDiseaseRequest.currentMetrics, no2: 51 },
        },
      ],
    ])('rejects invalid disease risk request (%s)', (_scenario, payload) => {
      expect(buildDiseaseRiskRequest(payload)).toMatchObject({ ok: false });
    });

    it('maps valid disease risk response requiring both WSSV and AHPND_EMS', () => {
      const mapped = mapDiseaseRiskResponse({
        overallRiskScore: 72,
        overallRiskLevel: 'DANGER',
        diseases: [
          {
            diseaseCode: 'WSSV',
            diseaseName: 'White Spot Syndrome Virus',
            riskScore: 72,
            riskLevel: 'DANGER',
            indicators: ['Low temp 24.5C', 'Temp drop 3.8C'],
            recommendations: ['Stabilize water level'],
          },
          {
            diseaseCode: 'AHPND_EMS',
            riskScore: 45,
            riskLevel: 'WARNING',
            indicators: ['pH swing 0.5'],
            recommendations: ['Apply probiotics'],
          },
        ],
        recommendations: ['Stabilize water level', 'Apply probiotics'],
      });

      expect(mapped).toEqual({
        ok: true,
        value: {
          overallRiskScore: 0.72,
          overallRiskLevel: RiskLevel.HIGH,
          diseases: [
            {
              diseaseCode: 'WSSV',
              diseaseName: 'White Spot Syndrome Virus',
              riskScore: 0.72,
              riskLevel: RiskLevel.HIGH,
              indicators: ['Low temp 24.5C', 'Temp drop 3.8C'],
              recommendations: ['Stabilize water level'],
            },
            {
              diseaseCode: 'AHPND_EMS',
              diseaseName: 'Bệnh hoại tử gan tụy cấp (AHPND/EMS)',
              riskScore: 0.45,
              riskLevel: RiskLevel.MEDIUM,
              indicators: ['pH swing 0.5'],
              recommendations: ['Apply probiotics'],
            },
          ],
          recommendations: ['Stabilize water level', 'Apply probiotics'],
        },
      });
    });

    it('maps FastAPI canonical { code, name } disease risk format cleanly', () => {
      const mapped = mapDiseaseRiskResponse({
        pondId: validDiseaseRequest.pondId,
        overallRiskScore: 76,
        overallRiskLevel: 'DANGER',
        diseases: [
          {
            code: 'WSSV',
            name: 'Bệnh Đốm trắng (WSSV)',
            riskScore: 76,
            riskLevel: 'DANGER',
            indicators: ['Nhiệt độ lạnh sâu'],
            recommendations: ['Giữ mực nước ổn định'],
          },
          {
            code: 'AHPND_EMS',
            name: 'Bệnh Hoại tử gan tụy cấp (AHPND/EMS)',
            riskScore: 22,
            riskLevel: 'SAFE',
            indicators: ['Chưa ghi nhận yếu tố bất lợi'],
            recommendations: ['Duy trì vi sinh'],
          },
        ],
        recommendations: ['Giữ mực nước ổn định'],
      });

      expect(mapped).toEqual({
        ok: true,
        value: {
          overallRiskScore: 0.76,
          overallRiskLevel: RiskLevel.HIGH,
          diseases: [
            {
              diseaseCode: 'WSSV',
              diseaseName: 'Bệnh Đốm trắng (WSSV)',
              riskScore: 0.76,
              riskLevel: RiskLevel.HIGH,
              indicators: ['Nhiệt độ lạnh sâu'],
              recommendations: ['Giữ mực nước ổn định'],
            },
            {
              diseaseCode: 'AHPND_EMS',
              diseaseName: 'Bệnh Hoại tử gan tụy cấp (AHPND/EMS)',
              riskScore: 0.22,
              riskLevel: RiskLevel.LOW,
              indicators: ['Chưa ghi nhận yếu tố bất lợi'],
              recommendations: ['Duy trì vi sinh'],
            },
          ],
          recommendations: ['Giữ mực nước ổn định'],
        },
      });
    });

    const wssvItem = {
      diseaseCode: 'WSSV',
      riskScore: 20,
      riskLevel: 'SAFE',
      indicators: ['Stable temp'],
      recommendations: ['Monitor daily'],
    };
    const ahpndItem = {
      diseaseCode: 'AHPND_EMS',
      riskScore: 30,
      riskLevel: 'SAFE',
      indicators: ['Normal pH'],
      recommendations: ['Maintain probiotics'],
    };

    it.each([
      [null],
      [{ overallRiskScore: 120, overallRiskLevel: 'SAFE', diseases: [wssvItem, ahpndItem] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'HIGH', diseases: [wssvItem, ahpndItem] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'SAFE', diseases: [] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'SAFE', diseases: [wssvItem] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'SAFE', diseases: [ahpndItem] }],
      [{ overallRiskScore: 25, overallRiskLevel: 'SAFE', diseases: [wssvItem, wssvItem] }],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          diseases: [{ ...wssvItem, riskScore: -5 }, ahpndItem],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          diseases: [wssvItem, { ...ahpndItem, riskLevel: 'MEDIUM' }],
        },
      ],
      [
        {
          overallRiskScore: 25,
          overallRiskLevel: 'SAFE',
          diseases: [wssvItem, { ...ahpndItem, indicators: 'bad' }],
        },
      ],
    ])('rejects invalid disease risk response: %o', (payload) => {
      expect(mapDiseaseRiskResponse(payload)).toMatchObject({ ok: false });
    });
  });
});
