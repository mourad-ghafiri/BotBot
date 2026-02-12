import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AGENT_JOBS_QUEUE } from './agent-job.types';
import { TOOL_JOBS_QUEUE } from './tool-job.types';
import { TaskSchedulerService } from './task-scheduler.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskProcessor } from './task.processor';
import { AgentProcessor } from './agent.processor';
import { ToolProcessor } from './tool.processor';
import { AgentQueueService } from './agent-queue.service';
import { AgentModule } from '../agent/agent.module';
import { SkillsModule } from '../skills/skills.module';
import { TaskModule } from '../task/task.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'botbot-tasks' },
      { name: AGENT_JOBS_QUEUE },
      { name: TOOL_JOBS_QUEUE },
    ),
    TaskModule,
    SkillsModule,
    forwardRef(() => AgentModule),
  ],
  providers: [TaskSchedulerService, TaskLifecycleService, TaskProcessor, AgentProcessor, ToolProcessor, AgentQueueService],
  exports: [TaskSchedulerService, AgentQueueService],
})
export class QueueModule {}
