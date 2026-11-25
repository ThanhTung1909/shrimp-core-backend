import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { NotificationDispatcherService } from '../notifications/notification-dispatcher.service.js';
import { AiRiskAlertsService } from './ai-risk-alerts.service.js';
import { AiRiskNotificationOutbox } from './entities/ai-risk-notification-outbox.entity.js';

/** Drains durable AI-risk notification intents after the alert transaction commits. */
@Injectable()
export class AiRiskNotificationOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiRiskNotificationOutboxWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly alertsService: AlertsService,
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly aiRiskAlertsService: AiRiskAlertsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.aiRiskAlertsService.isEnabled()) return;
    void this.drain();
    this.timer = setInterval(() => void this.drain(), this.pollMs());
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pollMs(): number {
    return Math.max(250, Number(this.config.get<string>('AI_RISK_ALERTS_OUTBOX_POLL_MS') || 1_000));
  }

  private lockMs(): number {
    return Math.max(this.pollMs() * 2, Number(this.config.get<string>('AI_RISK_ALERTS_OUTBOX_LOCK_MS') || 30_000));
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.aiRiskAlertsService.isEnabled()) return;
    this.draining = true;
    try {
      for (let processed = 0; processed < 20; processed += 1) {
        const intent = await this.claimNext();
        if (!intent) return;
        await this.dispatch(intent);
      }
    } finally {
      this.draining = false;
    }
  }

  private async claimNext(): Promise<AiRiskNotificationOutbox | null> {
    const now = new Date();
    const staleLockBefore = new Date(now.getTime() - this.lockMs());
    return this.dataSource.transaction(async (manager) => {
      const intent = await manager.getRepository(AiRiskNotificationOutbox)
        .createQueryBuilder('outbox')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('(outbox.status = :pending AND outbox.nextAttemptAt <= :now) OR (outbox.status = :processing AND outbox.lastAttemptAt <= :staleLockBefore)', {
          pending: 'PENDING', processing: 'PROCESSING', now, staleLockBefore,
        })
        .orderBy('outbox.createdAt', 'ASC')
        .getOne();
      if (!intent) return null;
      intent.status = 'PROCESSING';
      intent.attemptCount += 1;
      intent.lastAttemptAt = now;
      await manager.save(AiRiskNotificationOutbox, intent);
      return intent;
    });
  }

  private async dispatch(intent: AiRiskNotificationOutbox): Promise<void> {
    try {
      const alert = await this.dataSource.getRepository(Alert).findOneBy({ alertId: intent.alertId });
      if (!alert) {
        await this.markDispatched(intent.outboxId);
        return;
      }
      // Dispatch directly from the durable intent. The Redis publish below is
      // retained for UI fan-out; a listener outage cannot lose this notification.
      await this.notificationDispatcher.dispatchAlert(alert);
      await this.alertsService.publishAlertTriggered(alert);
      await this.markDispatched(intent.outboxId);
    } catch (error) {
      await this.markRetry(intent, error);
    }
  }

  private async markDispatched(outboxId: string): Promise<void> {
    await this.dataSource.getRepository(AiRiskNotificationOutbox).update(
      { outboxId },
      { status: 'DISPATCHED', lastError: null },
    );
  }

  private async markRetry(intent: AiRiskNotificationOutbox, error: unknown): Promise<void> {
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(intent.attemptCount, 6));
    const message = error instanceof Error ? error.message.slice(0, 500) : 'notification dispatch failed';
    this.logger.error('[AI Risk Notification Outbox] Dispatch failed; intent remains durable for retry.');
    await this.dataSource.getRepository(AiRiskNotificationOutbox).update(
      { outboxId: intent.outboxId },
      { status: 'PENDING', nextAttemptAt: new Date(Date.now() + delayMs), lastError: message },
    );
  }
}
