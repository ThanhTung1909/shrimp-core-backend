import { Injectable, MethodNotAllowedException } from '@nestjs/common';

/**
 * Keeps the controller dependency graph valid without creating a BullMQ
 * client. HTTP-only mode rejects non-read methods before this is reachable.
 */
@Injectable()
export class HttpOnlyPredictionSchedulerService {
  async triggerActivePondsNow(): Promise<never> {
    throw new MethodNotAllowedException(
      'HTTP-only mode does not allow background prediction jobs.',
    );
  }
}
