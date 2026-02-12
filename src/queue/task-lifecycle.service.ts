import { Injectable, Logger } from '@nestjs/common';
import { AgentQueueService } from './agent-queue.service';
import { TaskService } from '../task/task.service';
import { TaskSchedulerService } from './task-scheduler.service';
import { EventBusService } from '../events/event-bus.service';
import { AgentJobPriority } from './agent-job.types';
import {
  BotEvent,
  TaskStartedPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
} from '../events/events';

const EXECUTION_PROMPT =
  'You are executing a scheduled task. ' +
  'Task management tools (task_create, task_list, task_update, task_cancel) are NOT available in this context. ' +
  'Just execute the instruction below and return the result.\n\n';

@Injectable()
export class TaskLifecycleService {
  private readonly logger = new Logger(TaskLifecycleService.name);

  constructor(
    private readonly agentQueue: AgentQueueService,
    private readonly taskService: TaskService,
    private readonly scheduler: TaskSchedulerService,
    private readonly eventBus: EventBusService,
  ) {}

  async handleScheduledTask(taskId: string): Promise<void> {
    const task = await this.taskService.get(taskId);
    if (!task || !['scheduled', 'pending'].includes(task.status)) {
      this.logger.log(`Scheduled task ${taskId} — skipping (status=${task?.status})`);
      return;
    }

    if (task.taskType === 'execution') {
      await this.executeTask(task, false);
    } else {
      await this.handleReminder(task, false);
    }
  }

  async handleCronTask(taskId: string): Promise<void> {
    const task = await this.taskService.get(taskId);
    if (!task) return;
    if (['failed', 'cancelled'].includes(task.status)) {
      this.logger.log(`Cron task ${taskId} is ${task.status} — removing scheduler and skipping`);
      await this.scheduler.cancelTask(taskId);
      return;
    }

    if (task.taskType === 'execution') {
      await this.executeTask(task, true);
    } else {
      await this.handleReminder(task, true);
    }
  }

  private async handleReminder(
    task: { id: string; title: string; description: string | null; userId: string | null },
    isCron: boolean,
  ): Promise<void> {
    if (!isCron) {
      await this.taskService.update(task.id, { status: 'completed' });
    }

    const body = task.description || task.title;
    const prefix = isCron ? '\u{1F501}' : '\u{23F0}';

    this.eventBus.publish(BotEvent.NOTIFICATION_SEND, {
      title: `${prefix} ${task.title}`,
      body,
      userId: task.userId,
    });

    this.eventBus.publish(BotEvent.TASK_COMPLETED, {
      taskId: task.id,
      title: task.title,
      taskType: 'reminder',
      output: body,
      files: [],
      isCron,
    } satisfies TaskCompletedPayload);
  }

  private async executeTask(
    task: { id: string; title: string; description: string | null; taskType: string; userId: string | null },
    isCron: boolean,
  ): Promise<void> {
    const description = task.description || task.title;
    this.logger.log(`Executing task ${task.id}: ${task.title}`);

    await this.taskService.update(task.id, { status: 'running' });

    this.eventBus.publish(BotEvent.TASK_STARTED, {
      taskId: task.id,
      title: task.title,
      taskType: task.taskType,
    } satisfies TaskStartedPayload);

    try {
      const prompt = EXECUTION_PROMPT + description;
      const result = await this.agentQueue.enqueue({
        userMessage: prompt,
        userId: task.userId ?? undefined,
        priority: AgentJobPriority.TASK_EXECUTION,
        skipSecurity: true,
        disableTaskTools: true,
        activateAllSkills: true,
      });
      const responseText = result.text || '(no output)';

      const freshTask = await this.taskService.get(task.id);
      if (freshTask?.status === 'cancelled') {
        this.logger.log(`Task ${task.id} was cancelled during execution`);
        return;
      }

      await this.taskService.update(task.id, { status: isCron ? 'scheduled' : 'completed' });

      // Reset failure count on successful cron execution
      if (isCron) {
        await this.taskService.resetFailureCount(task.id);
      }

      this.eventBus.publish(BotEvent.NOTIFICATION_SEND, {
        title: `\u{2705} ${task.title}`,
        body: responseText,
        userId: task.userId,
      });
      for (const fpath of result.files) {
        this.eventBus.publish(BotEvent.FILE_SEND, { filePath: fpath, userId: task.userId });
      }

      this.eventBus.publish(BotEvent.TASK_COMPLETED, {
        taskId: task.id,
        title: task.title,
        taskType: task.taskType,
        output: responseText,
        files: result.files,
        isCron,
      } satisfies TaskCompletedPayload);

      this.logger.log(`Execution task ${task.id} completed`);
    } catch (err) {
      this.logger.error(`Execution task ${task.id} failed: ${err}`);

      if (isCron) {
        const failureCount = await this.taskService.incrementFailureCount(task.id);
        if (failureCount >= 3) {
          this.logger.warn(`Cron task ${task.id} auto-paused after ${failureCount} consecutive failures`);
          await this.taskService.update(task.id, { status: 'paused' });
          await this.scheduler.cancelTask(task.id);
          this.eventBus.publish(BotEvent.NOTIFICATION_SEND, {
            title: `\u{23F8}\u{FE0F} ${task.title}`,
            body: `Task '${task.title}' has been paused after ${failureCount} consecutive failures. Use task_update to re-enable it.`,
            userId: task.userId,
          });
        } else {
          await this.taskService.update(task.id, { status: 'scheduled' });
          this.eventBus.publish(BotEvent.NOTIFICATION_SEND, {
            title: `\u{274C} ${task.title}`,
            body: `Task failed (${failureCount}/3): ${err}`,
            userId: task.userId,
          });
        }
      } else {
        await this.taskService.update(task.id, { status: 'failed' });
        this.eventBus.publish(BotEvent.NOTIFICATION_SEND, {
          title: `\u{274C} ${task.title}`,
          body: `Task failed: ${err}`,
          userId: task.userId,
        });
      }

      this.eventBus.publish(BotEvent.TASK_FAILED, {
        taskId: task.id,
        title: task.title,
        error: String(err),
      } satisfies TaskFailedPayload);

      throw err;
    }
  }
}
