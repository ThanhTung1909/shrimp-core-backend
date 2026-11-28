import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryMqttService } from './telemetry-mqtt.service.js';
import { DeviceStatus } from '../../common/enums/device-status.enum.js';

const mockMqttConnect = vi.fn();

vi.mock('mqtt', () => ({
  connect: (...args: unknown[]) => mockMqttConnect(...args),
}));

class FakeMqttClient extends EventEmitter {
  subscribe = vi.fn(
    (
      _topics: string[],
      _opts: { qos: number },
      cb?: (err: Error | null) => void,
    ) => {
      cb?.(null);
    },
  );
  publish = vi.fn(
    (
      _topic: string,
      _payload: string,
      _opts: { qos: number; retain: boolean },
      cb?: (err?: Error | null) => void,
    ) => {
      cb?.(null);
    },
  );
  end = vi.fn();
}

describe('TelemetryMqttService', () => {
  let fakeClient: FakeMqttClient;
  let mockConfigService: { get: ReturnType<typeof vi.fn> };
  let mockTelemetryService: {
    processTelemetryPayloadWithAck: ReturnType<typeof vi.fn>;
    updateDeviceStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fakeClient = new FakeMqttClient();
    mockMqttConnect.mockReturnValue(fakeClient);
    mockConfigService = {
      get: vi.fn((key: string) =>
        key === 'MQTT_BROKER_URL' ? 'mqtt://broker.internal:1883' : undefined,
      ),
    };
    mockTelemetryService = {
      processTelemetryPayloadWithAck: vi.fn(),
      updateDeviceStatus: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('connects using MQTT_BROKER_URL on onModuleInit and subscribes to telemetry topics on connect', () => {
    const service = new TelemetryMqttService(
      mockConfigService as any,
      mockTelemetryService as any,
    );

    service.onModuleInit();

    expect(mockMqttConnect).toHaveBeenCalledWith('mqtt://broker.internal:1883', {
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    });

    fakeClient.emit('connect');

    expect(fakeClient.subscribe).toHaveBeenCalledWith(
      ['telemetry/devices/+/data', 'telemetry/devices/+/status'],
      { qos: 1 },
      expect.any(Function),
    );
  });

  it('falls back to default mqtt://localhost:1883 when MQTT_BROKER_URL is not configured', () => {
    mockConfigService.get.mockReturnValue(undefined);
    const service = new TelemetryMqttService(
      mockConfigService as any,
      mockTelemetryService as any,
    );

    service.onModuleInit();

    expect(mockMqttConnect).toHaveBeenCalledWith('mqtt://localhost:1883', {
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    });
  });

  it('processes valid data payload via processTelemetryPayloadWithAck and publishes ACK when acknowledged is true', async () => {
    const service = new TelemetryMqttService(
      mockConfigService as any,
      mockTelemetryService as any,
    );
    service.onModuleInit();

    mockTelemetryService.processTelemetryPayloadWithAck.mockResolvedValue({
      record: { id: 'tel-1' },
      acknowledged: true,
      duplicate: false,
    });

    const payload = Buffer.from(
      JSON.stringify({
        messageId: 'msg-101',
        temperature: 28.5,
        ph: 7.9,
      }),
    );

    await (service as any).handleIncomingMessage(
      'telemetry/devices/dev-001/data',
      payload,
    );

    expect(
      mockTelemetryService.processTelemetryPayloadWithAck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'dev-001',
        messageId: 'msg-101',
        temperature: 28.5,
        ph: 7.9,
      }),
    );

    expect(fakeClient.publish).toHaveBeenCalledWith(
      'telemetry/devices/dev-001/ack',
      JSON.stringify({
        deviceId: 'dev-001',
        messageId: 'msg-101',
        status: 'stored',
      }),
      { qos: 0, retain: false },
      expect.any(Function),
    );
  });

  it('publishes duplicate ACK status when acknowledged is true and duplicate is true, and skips ACK when acknowledged is false', async () => {
    const service = new TelemetryMqttService(
      mockConfigService as any,
      mockTelemetryService as any,
    );
    service.onModuleInit();

    mockTelemetryService.processTelemetryPayloadWithAck
      .mockResolvedValueOnce({
        record: null,
        acknowledged: true,
        duplicate: true,
      })
      .mockResolvedValueOnce({
        record: null,
        acknowledged: false,
        duplicate: false,
      });

    const payload = Buffer.from(
      JSON.stringify({
        messageId: 'msg-dup',
        temperature: 27.0,
      }),
    );

    await (service as any).handleIncomingMessage(
      'telemetry/devices/dev-002/data',
      payload,
    );

    expect(fakeClient.publish).toHaveBeenCalledTimes(1);
    expect(fakeClient.publish).toHaveBeenCalledWith(
      'telemetry/devices/dev-002/ack',
      JSON.stringify({
        deviceId: 'dev-002',
        messageId: 'msg-dup',
        status: 'duplicate',
      }),
      { qos: 0, retain: false },
      expect.any(Function),
    );

    await (service as any).handleIncomingMessage(
      'telemetry/devices/dev-002/data',
      payload,
    );

    expect(fakeClient.publish).toHaveBeenCalledTimes(1);
  });

  it('processes valid status payload via telemetryService.updateDeviceStatus', async () => {
    const service = new TelemetryMqttService(
      mockConfigService as any,
      mockTelemetryService as any,
    );
    service.onModuleInit();

    const payload = Buffer.from(
      JSON.stringify({ status: DeviceStatus.ONLINE }),
    );

    await (service as any).handleIncomingMessage(
      'telemetry/devices/dev-003/status',
      payload,
    );

    expect(mockTelemetryService.updateDeviceStatus).toHaveBeenCalledWith(
      'dev-003',
      DeviceStatus.ONLINE,
    );
  });

  it('closes MQTT client via client.end() on onModuleDestroy', () => {
    const service = new TelemetryMqttService(
      mockConfigService as any,
      mockTelemetryService as any,
    );
    service.onModuleInit();

    service.onModuleDestroy();

    expect(fakeClient.end).toHaveBeenCalledTimes(1);
  });

  it('ensures src/main.ts contains no mqtt import and no mqtt.connect(', () => {
    const mainSource = readFileSync(
      resolve(process.cwd(), 'src/main.ts'),
      'utf-8',
    );

    expect(mainSource).not.toMatch(/from\s+['"]mqtt['"]/);
    expect(mainSource).not.toContain('mqtt.connect(');
  });
});
