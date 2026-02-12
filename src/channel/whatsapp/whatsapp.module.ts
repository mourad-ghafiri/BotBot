import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppListener } from './whatsapp.listener';
import { QueueModule } from '../../queue/queue.module';
import { ConversationModule } from '../../conversation/conversation.module';

@Module({
  imports: [QueueModule, ConversationModule],
  providers: [WhatsAppService, WhatsAppListener],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
