import { describe, expect, it } from 'vitest';
import { RiskLevel } from '../../../common/enums/risk-level.enum.js';
import {
  AI_PREDICTION_CONTRACT_VERSION,
  buildAiPredictionRequest,
  mapAiPredictionResponse,
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
    expect(buildAiPredictionRequest(validRequest)).toEqual({
      ok: true,
      value: {
        pondId: validRequest.pondId,
        temperature: validRequest.currentTemp,
        ph: validRequest.currentPH,
        dissolvedOxygen: validRequest.currentDO,
        salinity: validRequest.salinity,
        turbidity: validRequest.turbidity,
        timestamp: validRequest.timestamp,
      },
    });
  });

  it('does not restrict a canonical UUID to legacy UUID versions', () => {
    const uuidV7Request = { ...validRequest, pondId: '018f0a5c-fd55-7f2a-9d33-a8dc439af556' };
    expect(buildAiPredictionRequest(uuidV7Request)).toMatchObject({
      ok: true,
      value: { pondId: uuidV7Request.pondId },
    });
  });

  it('uses one explicitly versioned FastAPI develop vocabulary with no compatibility keys', () => {
    const result = buildAiPredictionRequest(validRequest, AI_PREDICTION_CONTRACT_VERSION);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toEqual(expect.objectContaining({
      temperature: 28.5,
      ph: 7.7,
      dissolvedOxygen: 5.2,
    }));
    expect(result.value).not.toHaveProperty('currentDO');
    expect(result.value).not.toHaveProperty('currentPH');
    expect(result.value).not.toHaveProperty('currentTemp');
  });

  it('refuses an unrecognised adapter version before any HTTP request can be made', () => {
    expect(buildAiPredictionRequest(validRequest, 'unknown-v2')).toEqual({
      ok: false,
      reason: 'unsupported AI prediction contract version: unknown-v2',
    });
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
});
