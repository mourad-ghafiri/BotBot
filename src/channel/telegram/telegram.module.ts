import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramListener } from './telegram.listener';
import { QueueModule } from '../../queue/queue.module';
import { ConversationModule } from '../../conversation/conversation.module';
import { SkillsModule } from '../../skills/skills.module';
import { MemoryModule } from '../../memory/memory.module';
import { TaskModule } from '../../task/task.module';

@Module({
  imports: [QueueModule, ConversationModule, SkillsModule, MemoryModule, TaskModule],
  providers: [TelegramService, TelegramListener],
  exports: [TelegramService],
})
export class TelegramModule {}
