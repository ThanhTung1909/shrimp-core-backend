import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_PREDICTIONS,
  PREDICTION_JOBS,
} from '../../common/queues/queue.constants.js';

@Injectable()
export class PredictionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(PredictionSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_PREDICTIONS)
    private readonly predictionQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.setupPeriodicPredictionsJob();
  }

  /**
   * Thiết lập Repeatable Job trên BullMQ để tự động trigger tính toán AI mỗi 30 phút/lần
   */
  async setupPeriodicPredictionsJob() {
    const repeatableJobId = 'periodic-active-ponds-prediction';

    // Kiểm tra xem job lặp lại đã được đăng ký trong Redis chưa để tránh race condition khi scale nhiều instances
    try {
      const repeatableJobs = await this.predictionQueue.getRepeatableJobs();
      const alreadyScheduled = repeatableJobs.some(
        (job) => job.name === PREDICTION_JOBS.CRON_ACTIVE_PONDS && job.pattern === '*/30 * * * *',
      );
      if (alreadyScheduled) {
        this.logger.log('⏰ [Scheduler] Repeatable job dự báo AI đã sẵn sàng trong Redis, bỏ qua đăng ký trùng lặp.');
        return;
      }
    } catch (err: any) {
      this.logger.warn(`[Scheduler] Không thể kiểm tra repeatable jobs: ${err.message}`);
    }

    // Đăng ký lặp lại mỗi 30 phút (Cron pattern: */30 * * * *)
    await this.predictionQueue.add(
      PREDICTION_JOBS.CRON_ACTIVE_PONDS,
      {},
      {
        repeat: {
          pattern: '*/30 * * * *',
        },
        jobId: repeatableJobId,
        removeOnComplete: true,
      },
    );

    this.logger.log('⏰ [Scheduler] Đã lên lịch tự động chạy dự báo AI cho các ao active định kỳ mỗi 30 phút/lần.');
  }

  /**
   * Cho phép trigger tính toán dự báo ngay lập tức (dùng khi kiểm thử hoặc kích hoạt thủ công)
   */
  async triggerActivePondsNow() {
    this.logger.log('[Scheduler] Kích hoạt thủ công tính toán AI cho các ao active...');
    return this.predictionQueue.add(
      PREDICTION_JOBS.CRON_ACTIVE_PONDS,
      { manualTrigger: true, timestamp: new Date().toISOString() },
      { removeOnComplete: true },
    );
  }
}
