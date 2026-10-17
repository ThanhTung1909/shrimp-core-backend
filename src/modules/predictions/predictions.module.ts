import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AiPrediction } from './entities/ai-prediction.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { QUEUE_PREDICTIONS } from '../../common/queues/queue.constants.js';
import { PredictionsService } from './predictions.service.js';
import { PredictionQueueProcessor } from './processors/prediction.processor.js';
import { PredictionSchedulerService } from './prediction-scheduler.service.js';
import { PredictionsController } from './predictions.controller.js';
import { TelemetryModule } from '../telemetry/telemetry.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiPrediction, Pond]),
    BullModule.registerQueue({
      name: QUEUE_PREDICTIONS,
    }),
    TelemetryModule,
  ],
  controllers: [PredictionsController],
  providers: [
    PredictionsService,
    PredictionQueueProcessor,
    PredictionSchedulerService,
  ],
  exports: [
    PredictionsService,
    BullModule,
    TypeOrmModule,
  ],
})
export class PredictionsModule {}
