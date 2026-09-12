import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TelemetryService } from './telemetry.service.js';
import { CreateTelemetryDto } from './dto/create-telemetry.dto.js';

@Injectable()
export class TelemetryMqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryMqttService.name);
  private client: mqtt.MqttClient;

  // Wildcard Topic quy chuẩn: telemetry/devices/<deviceId>/data
  private readonly topicPattern = 'telemetry/devices/+/data';

  constructor(
    private readonly configService: ConfigService,
    private readonly telemetryService: TelemetryService,
  ) { }

  onModuleInit() {
    this.connectAndSubscribe();
  }

  onModuleDestroy() {
    if (this.client) {
      this.logger.log('[MQTT] Đang ngắt kết nối MQTT Client...');
      this.client.end();
    }
  }

  private connectAndSubscribe() {
    const brokerUrl =
      this.configService.get<string>('MQTT_BROKER_URL') || 'mqtt://localhost:1883';

    this.logger.log(`[MQTT] Đang kết nối tới MQTT Broker: ${brokerUrl}`);

    this.client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    });

    this.client.on('connect', () => {
      this.logger.log(`[MQTT] Kết nối thành công tới Broker: ${brokerUrl}`);
      this.subscribeToTelemetryTopic();
    });

    this.client.on('reconnect', () => {
      this.logger.warn(`[MQTT] Đang thử kết nối lại tới Broker...`);
    });

    this.client.on('error', (err) => {
      this.logger.error(`[MQTT] Lỗi kết nối Broker: ${err.message}`);
    });

    this.client.on('message', async (topic, message) => {
      await this.handleIncomingMessage(topic, message);
    });
  }

  private subscribeToTelemetryTopic() {
    this.client.subscribe(this.topicPattern, { qos: 1 }, (err) => {
      if (err) {
        this.logger.error(
          `[MQTT] Không thể đăng ký (subscribe) topic ${this.topicPattern}: ${err.message}`,
        );
      } else {
        this.logger.log(
          `[MQTT] Đã đăng ký thành công topic lắng nghe: ${this.topicPattern}`,
        );
      }
    });
  }

  /**
   * Xử lý gói tin MQTT từ thiết bị:
   * 1. Bóc tách chuỗi JSON
   * 2. Transform & Validate gói tin với CreateTelemetryDto
   * 3. Chuyển cho TelemetryService xử lý lưu trữ & cập nhật thiết bị
   */
  private async handleIncomingMessage(topic: string, message: Buffer) {
    try {
      const payloadString = message.toString('utf-8');
      const parsedJson = JSON.parse(payloadString);

      // Validate định dạng payload qua DTO
      const dto = plainToInstance(CreateTelemetryDto, parsedJson);
      const errors = await validate(dto);

      if (errors.length > 0) {
        const errorMessages = errors
          .map((err) => Object.values(err.constraints || {}).join(', '))
          .join('; ');
        this.logger.warn(
          `[MQTT Payload Invalid] Gói tin từ topic ${topic} không hợp lệ: ${errorMessages}`,
        );
        return;
      }

      await this.telemetryService.processTelemetryPayload(dto);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[MQTT Payload Error] Lỗi giải mã hoặc xử lý gói tin từ topic ${topic}: ${errMessage}`,
      );
    }
  }
}
