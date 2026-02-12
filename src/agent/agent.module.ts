import { Module, forwardRef } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module';
import { SecurityModule } from '../security/security.module';
import { SkillsModule } from '../skills/skills.module';
import { MemoryModule } from '../memory/memory.module';
import { ConversationModule } from '../conversation/conversation.module';
import { TaskModule } from '../task/task.module';
import { QueueModule } from '../queue/queue.module';
import { ToolDispatcherService } from '../queue/tool-dispatcher.service';
import { AgentService } from './agent.service';
import { PromptService } from './prompt.service';
import { ProactiveEvaluatorService } from './proactive-evaluator.service';

@Module({
  imports: [
    LLMModule, SecurityModule, SkillsModule, MemoryModule, ConversationModule,
    TaskModule,
    forwardRef(() => QueueModule),
  ],
  providers: [AgentService, ToolDispatcherService, PromptService, ProactiveEvaluatorService],
  exports: [AgentService, ToolDispatcherService],
})
export class AgentModule {}
