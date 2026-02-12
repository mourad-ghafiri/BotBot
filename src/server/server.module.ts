import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { EventsController } from './events.controller';
import { ApiKeyGuard } from './auth.guard';
import { SseService } from './sse.service';
import { ServerListener } from './server.listener';
import { QueueModule } from '../queue/queue.module';
import { ConversationModule } from '../conversation/conversation.module';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [QueueModule, ConversationModule, SkillsModule],
  controllers: [ChatController, EventsController],
  providers: [ApiKeyGuard, SseService, ServerListener],
  exports: [SseService],
})
export class ServerModule {}
