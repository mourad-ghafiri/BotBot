import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job as BullJob } from 'bullmq';
import { TaskLifecycleService } from './task-lifecycle.service';
import { EventBusService } from '../events/event-bus.service';
import { BotEvent, ProactiveMessagePayload } from '../events/events';

@Processor('botbot-tasks')
export class TaskProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TaskProcessor.name);

  constructor(
    private readonly lifecycle: TaskLifecycleService,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.BOTBOT_WORKER_MODE) {
      await this.worker.pause();
      this.logger.log('TaskProcessor paused (worker mode)');
      return;
    }
    const concurrency = this.config.get('queue.task_concurrency', 3);
    this.worker.concurrency = concurrency;
    this.logger.log(`TaskProcessor concurrency set to ${concurrency}`);
  }

  async process(bullJob: BullJob): Promise<void> {
    switch (bullJob.name) {
      case 'scheduled-task':
        await this.lifecycle.handleScheduledTask(bullJob.data.taskId);
        break;
      case 'cron-task':
        await this.lifecycle.handleCronTask(bullJob.data.taskId);
        break;
      case 'proactive-delivery': {
        const { userId, message, channel } = bullJob.data;
        this.logger.log(`Delivering proactive message for user ${userId}`);
        this.eventBus.publish(BotEvent.PROACTIVE_MESSAGE, {
          userId,
          message,
          channel,
        } satisfies ProactiveMessagePayload);
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${bullJob.name}`);
    }
  }
}
