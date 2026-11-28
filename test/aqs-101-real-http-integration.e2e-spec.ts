/**
 * Opt-in-free, isolated transport evidence for the Core-to-AI contract.
 *
 * Vitest executes the real NestJS PredictionsService in Node while it starts
 * the real FastAPI app in a separate Python/Uvicorn process on loopback. No
 * NestJS HTTP server, database, Redis, RabbitMQ, MQTT broker, or production
 * approval setting is used. The approved flag exists only in ConfigService
 * instances constructed by this test.
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RiskLevel } from '../src/common/enums/risk-level.enum.js';
import { PredictionsService } from '../src/modules/predictions/predictions.service.js';

const projectRoot = path.resolve(process.cwd(), '..');
const aiServiceDir = process.env.AQS_AI_SERVICE_DIR ?? path.join(projectRoot, 'shrimp-ai-service');
const pythonExecutable = process.env.AQS_AI_TEST_PYTHON
  ?? path.join(aiServiceDir, '.venv-aqs101', 'Scripts', 'python.exe');

const pondId = '78ad6b2a-b628-4c7f-9f2c-91953a3ea2cb';
let fastApiProcess: ChildProcessWithoutNullStreams;
let predictUrl: string;
let childOutput = '';

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not reserve a loopback port for FastAPI.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForFastApi(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/openapi.json`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`FastAPI isolated process did not become ready: ${String(lastError)}\n${childOutput}`);
}

async function readPredictRequestCount(): Promise<number> {
  const response = await fetch(predictUrl.replace('/api/predict', '/_test/http-request-count'));
  expect(response.status).toBe(200);
  return (await response.json() as { predictRequests: number }).predictRequests;
}

function createPredictionsService(approval: 'true' | 'false') {
  const savedRecords: unknown[] = [];
  const predictionRepo = {
    create: vi.fn((value) => ({ predictionId: randomUUID(), ...value })),
    save: vi.fn(async (value) => {
      savedRecords.push(value);
      return value;
    }),
  };
  const pondRepo = {
    findOne: vi.fn(async () => ({
      pondId,
      devices: [{ deviceId: 'synthetic-loopback-device' }],
    })),
  };
  const telemetry = {
    getLatestByDeviceId: vi.fn(async () => ({
      dissolvedOxygen: 5.2,
      ph: 7.8,
      temperature: 29.5,
      salinity: 15,
      turbidity: 20,
      recordedAt: new Date(Date.now() - 60_000),
    })),
  };
  const config = new ConfigService({
    AI_PREDICTION_API_URL: predictUrl,
    AI_PREDICTION_CONTRACT_VERSION: 'ai-develop-v1',
    AI_PRODUCTION_INFERENCE_APPROVED: approval,
    PREDICTION_TELEMETRY_MAX_AGE_MINUTES: '15',
  });

  return {
    savedRecords,
    service: new PredictionsService(
      predictionRepo as never,
      pondRepo as never,
      config,
      telemetry as never,
    ),
  };
}

describe('AQS-101 real Core-to-FastAPI loopback transport', () => {
  beforeAll(async () => {
    expect(existsSync(pythonExecutable)).toBe(true);
    const port = await reserveLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    predictUrl = `${baseUrl}/api/predict`;

    fastApiProcess = spawn(
      pythonExecutable,
      ['-c', `
import sys
import uvicorn
from app.main import app

predict_requests = 0

@app.middleware("http")
async def count_predict_requests(request, call_next):
    global predict_requests
    if request.method == "POST" and request.url.path == "/api/predict":
        predict_requests += 1
    return await call_next(request)

@app.get("/_test/http-request-count")
async def read_count():
    return {"predictRequests": predict_requests}

uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]),
            log_level="warning", lifespan="off")
`, String(port)],
      {
        cwd: aiServiceDir,
        env: {
          ...process.env,
          APP_ENV: 'aqs-http-integration-test',
          APP_PORT: String(port),
          PYTHONDONTWRITEBYTECODE: '1',
        },
      },
    );
    fastApiProcess.stdout.on('data', (chunk) => { childOutput += String(chunk); });
    fastApiProcess.stderr.on('data', (chunk) => { childOutput += String(chunk); });

    await waitForFastApi(baseUrl);
  }, 20_000);

  afterAll(async () => {
    if (fastApiProcess && fastApiProcess.exitCode === null) {
      fastApiProcess.kill();
      await new Promise<void>((resolve) => fastApiProcess.once('exit', () => resolve()));
    }
  });

  it('keeps approval OFF on HEURISTIC_RULE and sends no FastAPI HTTP request', async () => {
    const beforeRequests = await readPredictRequestCount();
    const { service, savedRecords } = createPredictionsService('false');

    const prediction = await service.predictForPond(pondId);

    expect(await readPredictRequestCount()).toBe(beforeRequests);
    expect(prediction.isFallback).toBe(true);
    expect(prediction.predictionSource).toBe('HEURISTIC_RULE');
    expect(prediction.riskLevel).toBe(RiskLevel.LOW);
    expect(savedRecords).toHaveLength(1);
  });

  it('maps a valid FastAPI response over real loopback HTTP in test-only transport mode', async () => {
    const canonicalPayload = {
      pondId,
      temperature: 29.5,
      ph: 7.8,
      dissolvedOxygen: 5.2,
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      salinity: 15,
      turbidity: 20,
    };
    const directResponse = await fetch(predictUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(canonicalPayload),
    });
    expect(directResponse.status).toBe(200);
    const fastApiPayload = await directResponse.json() as {
      predictedDO: number;
      predictedPH: number;
      riskScore: number;
      riskLevel: 'SAFE' | 'WARNING' | 'DANGER';
    };
    const requestsAfterDirectProbe = await readPredictRequestCount();
    const { service, savedRecords } = createPredictionsService('true');

    const prediction = await service.predictForPond(pondId);

    expect(await readPredictRequestCount()).toBe(requestsAfterDirectProbe + 1);
    expect(prediction.isFallback).toBe(false);
    expect(prediction.predictionSource).toBe('AI_MICROSERVICE');
    expect(prediction.predictedDO).toBe(fastApiPayload.predictedDO);
    expect(prediction.predictedPH).toBe(fastApiPayload.predictedPH);
    expect(prediction.riskScore).toBe(fastApiPayload.riskScore / 100);
    expect(prediction.riskLevel).toBe(
      fastApiPayload.riskLevel === 'SAFE'
        ? RiskLevel.LOW
        : fastApiPayload.riskLevel === 'WARNING'
          ? RiskLevel.MEDIUM
          : RiskLevel.HIGH,
    );
    expect(savedRecords).toHaveLength(1);
  });

  it('counts rejected legacy and incomplete prediction requests', async () => {
    const beforeRequests = await readPredictRequestCount();
    const payloads = [
      { currentDO: 5.2, currentPH: 7.8, currentTemp: 29.5, salinity: 15, turbidity: 20 },
      { dissolvedOxygen: 5.2, ph: 7.8, temperature: 29.5 },
    ];
    for (const payload of payloads) {
      const response = await fetch(predictUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error_type: 'VALIDATION_ERROR' });
    }
    expect(await readPredictRequestCount()).toBe(beforeRequests + payloads.length);
  });
});
