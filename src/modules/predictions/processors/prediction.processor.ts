import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import {
  QUEUE_PREDICTIONS,
  PREDICTION_JOBS,
  type TriggerPondPredictionJobData,
} from '../../../common/queues/queue.constants.js';
import { PredictionsService } from '../predictions.service.js';

@Processor(QUEUE_PREDICTIONS)
export class PredictionQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(PredictionQueueProcessor.name);

  constructor(
    private readonly predictionsService: PredictionsService,
    @InjectQueue(QUEUE_PREDICTIONS)
    private readonly predictionQueue: Queue,
  ) {
    super();
  }

  /**
   * Xử lý các job trong Queue predictions:
   * 1. trigger-pond-prediction: Kích hoạt tính toán AI cho 1 ao nuôi cụ thể
   * 2. cron-active-ponds-prediction: Quét tất cả các ao active và phân phối job tính toán
   */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(
      `[Prediction Worker] Nhận job ID: ${job.id}, Name: ${job.name}`,
    );

    switch (job.name) {
      case PREDICTION_JOBS.TRIGGER_POND: {
        const { pondId } = job.data as TriggerPondPredictionJobData;
        if (!pondId) {
          throw new Error('Thiếu pondId để thực hiện dự báo');
        }
        return await this.predictionsService.predictForPond(pondId);
      }

      case PREDICTION_JOBS.CRON_ACTIVE_PONDS: {
        return await this.handleCronActivePonds();
      }

      default:
        this.logger.warn(`[Prediction Worker] Bỏ qua job không xác định: ${job.name}`);
        return null;
    }
  }

  private async handleCronActivePonds(): Promise<{ triggeredCount: number }> {
    this.logger.log('[Prediction Worker] Bắt đầu quét các ao nuôi active để kích hoạt dự báo AI định kỳ (30 phút/lần)...');
    const activePondIds = await this.predictionsService.getActivePondIds();

    this.logger.log(`[Prediction Worker] Tìm thấy ${activePondIds.length} ao nuôi đang active.`);

    for (const pondId of activePondIds) {
      await this.predictionQueue.add(
        PREDICTION_JOBS.TRIGGER_POND,
        { pondId },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 5000 },
          removeOnComplete: true,
        },
      );
    }

    return { triggeredCount: activePondIds.length };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`[Prediction Worker] Job ${job.id} (${job.name}) hoàn thành thành công.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[Prediction Worker Failed] Job ${job.id} (${job.name}) thất bại: ${error.message}`,
    );
  }
}
