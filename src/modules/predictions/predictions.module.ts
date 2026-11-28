import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiPrediction } from './entities/ai-prediction.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { ManualTestLog } from '../ponds/entities/manual-test-log.entity.js';
import { ShrimpBatch } from '../crops/entities/shrimp-batch.entity.js';
import { QUEUE_PREDICTIONS } from '../../common/queues/queue.constants.js';
import { PredictionsService } from './predictions.service.js';
import { AiPredictionHttpClient } from './clients/ai-prediction-http.client.js';
import { PredictionQueueProcessor } from './processors/prediction.processor.js';
import { PredictionSchedulerService } from './prediction-scheduler.service.js';
import { PredictionsController } from './predictions.controller.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';
import { PondsModule } from '../ponds/ponds.module.js';
import { isHttpOnlyMode } from '../../common/runtime/http-only-mode.js';
import { HttpOnlyPredictionSchedulerService } from './http-only-prediction-scheduler.service.js';

const httpOnlyMode = isHttpOnlyMode();

@Module({
  imports: [
    TypeOrmModule.forFeature([AiPrediction, Pond, ManualTestLog, ShrimpBatch]),
    ...(!httpOnlyMode ? [BullModule.registerQueue({
      name: QUEUE_PREDICTIONS,
    })] : []),
    TelemetryModule,
    PondsModule,
  ],
  controllers: [PredictionsController],
  providers: [
    PredictionsService,
    AiPredictionHttpClient,
    ...(!httpOnlyMode
      ? [PredictionQueueProcessor, PredictionSchedulerService]
      : [
          {
            provide: PredictionSchedulerService,
            useClass: HttpOnlyPredictionSchedulerService,
          },
        ]),
  ],
  exports: [
    PredictionsService,
    AiPredictionHttpClient,
    ...(!httpOnlyMode ? [BullModule] : []),
    TypeOrmModule,
  ],
})
export class PredictionsModule {}
