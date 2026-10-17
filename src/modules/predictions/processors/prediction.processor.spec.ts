import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PredictionQueueProcessor } from './prediction.processor.js';
import { PREDICTION_JOBS } from '../../../common/queues/queue.constants.js';

describe('PredictionQueueProcessor', () => {
  let processor: PredictionQueueProcessor;
  let mockPredictionsService: any;
  let mockQueue: any;

  beforeEach(() => {
    mockPredictionsService = {
      predictForPond: vi.fn().mockResolvedValue({
        predictionId: 'pred-1',
        pondId: 'pond-100',
        predictedDO: 4.8,
        predictedPH: 7.9,
        riskScore: 0.2,
        riskLevel: 'LOW',
      }),
      getActivePondIds: vi.fn().mockResolvedValue(['pond-1', 'pond-2']),
    };

    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: 'job-sub-1' }),
    };

    processor = new PredictionQueueProcessor(mockPredictionsService, mockQueue as any);
  });

  describe('process: trigger-pond-prediction', () => {
    it('nên gọi predictionsService.predictForPond khi nhận job có pondId', async () => {
      const mockJob: any = {
        id: 'pred-job-1',
        name: PREDICTION_JOBS.TRIGGER_POND,
        data: {
          pondId: 'pond-100',
        },
      };

      const result = await processor.process(mockJob);

      expect(mockPredictionsService.predictForPond).toHaveBeenCalledWith('pond-100');
      expect(result).toEqual(
        expect.objectContaining({
          predictionId: 'pred-1',
          pondId: 'pond-100',
        }),
      );
    });

    it('nên ném lỗi khi thiếu pondId', async () => {
      const mockJob: any = {
        id: 'pred-job-2',
        name: PREDICTION_JOBS.TRIGGER_POND,
        data: {},
      };

      await expect(processor.process(mockJob)).rejects.toThrow('Thiếu pondId để thực hiện dự báo');
    });
  });

  describe('process: cron-active-ponds-prediction', () => {
    it('nên quét các ao active và đẩy job trigger-pond-prediction tương ứng vào queue', async () => {
      const mockJob: any = {
        id: 'cron-job-1',
        name: PREDICTION_JOBS.CRON_ACTIVE_PONDS,
        data: {},
      };

      const result = await processor.process(mockJob);

      expect(mockPredictionsService.getActivePondIds).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        PREDICTION_JOBS.TRIGGER_POND,
        { pondId: 'pond-1' },
        expect.any(Object),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        PREDICTION_JOBS.TRIGGER_POND,
        { pondId: 'pond-2' },
        expect.any(Object),
      );
      expect(result).toEqual({ triggeredCount: 2 });
    });
  });
});
