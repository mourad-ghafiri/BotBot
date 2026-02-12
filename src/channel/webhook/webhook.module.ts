import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookListener } from './webhook.listener';

@Module({
  providers: [WebhookService, WebhookListener],
  exports: [WebhookService],
})
export class WebhookModule {}
