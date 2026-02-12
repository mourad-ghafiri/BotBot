import { Module } from '@nestjs/common';
import { WebhookModule } from './webhook/webhook.module';
import { TelegramModule } from './telegram/telegram.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [WebhookModule, TelegramModule, WhatsAppModule],
  exports: [WebhookModule, TelegramModule, WhatsAppModule],
})
export class ChannelModule {}
