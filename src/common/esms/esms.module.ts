import { Global, Module } from '@nestjs/common';
import { EsmsService } from './esms.service.js';

@Global()
@Module({
  providers: [EsmsService],
  exports: [EsmsService],
})
export class EsmsModule {}
