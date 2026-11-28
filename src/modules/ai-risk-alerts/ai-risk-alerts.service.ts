import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Alert } from '../alerts/entities/alert.entity.js';
import { AlertStatus } from '../../common/enums/alert-status.enum.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { AiRiskAlertReceipt } from './entities/ai-risk-alert-receipt.entity.js';
import { AiRiskNotificationOutbox } from './entities/ai-risk-notification-outbox.entity.js';
import { mapRiskLevel, type ValidatedAiRiskEvent } from './ai-risk-event.validation.js';

export type AiRiskProcessResult = 'CREATED' | 'DUPLICATE' | 'IGNORED_LOW' | 'POLICY_DISABLED' | 'POND_NOT_FOUND';

@Injectable()
export class AiRiskAlertsService {
  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<string>('AI_RISK_ALERTS_CONSUMER_ENABLED') === 'true'
      && this.config.get<string>('AI_PRODUCTION_INFERENCE_APPROVED') === 'true';
  }

  async process(event: ValidatedAiRiskEvent): Promise<AiRiskProcessResult> {
    if (!this.isEnabled()) return 'POLICY_DISABLED';
    let createdAlert: Alert | undefined;
    const result = await this.dataSource.transaction(async (manager) => {
      try {
        await manager.insert(AiRiskAlertReceipt, { eventId: event.event_id, outcome: 'IGNORED_LOW', alertId: null });
      } catch (error: any) {
        if (error?.code === '23505') return 'DUPLICATE' as const;
        throw error;
      }
      const pond = await manager.findOne(Pond, { where: { pondId: event.pond_id } });
      if (!pond) throw new AiRiskPondNotFoundError();
      const alertLevel = mapRiskLevel(event.risk_level);
      if (!alertLevel) return 'IGNORED_LOW' as const;
      createdAlert = manager.create(Alert, {
        pondId: event.pond_id,
        deviceId: null,
        metricName: `AI predicted ${event.predicted_metric}`,
        triggeredValue: event.predicted_value,
        alertLevel,
        status: AlertStatus.ACTIVE,
        message: `Rủi ro dự báo bởi AI lúc ${event.occurredAt.toISOString()}: ${event.action_suggestion}`,
      });
      createdAlert = await manager.save(Alert, createdAlert);
      await manager.update(AiRiskAlertReceipt, { eventId: event.event_id }, { outcome: 'CREATED', alertId: createdAlert.alertId });
      await manager.insert(AiRiskNotificationOutbox, { alertId: createdAlert.alertId, status: 'PENDING' });
      return 'CREATED' as const;
    }).catch((error) => error instanceof AiRiskPondNotFoundError ? 'POND_NOT_FOUND' as const : Promise.reject(error));
    return result;
  }
}

class AiRiskPondNotFoundError extends Error {}
