import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskSchedulerRef } from '../task/task-scheduler.interface';

@Injectable()
export class TaskSchedulerService implements TaskSchedulerRef {
  private readonly logger = new Logger(TaskSchedulerService.name);

  constructor(
    @InjectQueue('botbot-tasks') private readonly taskQueue: Queue,
  ) {}

  // One-off scheduled task → BullMQ Delayed Job
  async scheduleTask(taskId: string, runDate: Date): Promise<void> {
    const delay = Math.max(runDate.getTime() - Date.now(), 0);
    await this.taskQueue.add(
      'scheduled-task',
      { taskId },
      {
        delay,
        jobId: `sched-${taskId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`Armed scheduled task ${taskId} (delay=${Math.round(delay / 1000)}s)`);
  }

  // Cron task → BullMQ Job Scheduler
  async registerCron(taskId: string, cronExpr: string): Promise<void> {
    await this.taskQueue.upsertJobScheduler(
      `cron-${taskId}`,
      { pattern: cronExpr },
      { name: 'cron-task', data: { taskId } },
    );
    this.logger.log(`Armed cron task ${taskId} (pattern=${cronExpr})`);
  }

  // Cancel → remove delayed job + remove job scheduler
  async cancelTask(taskId: string): Promise<void> {
    try {
      const job = await this.taskQueue.getJob(`sched-${taskId}`);
      if (job) {
        await job.remove();
        this.logger.log(`Removed delayed job for task ${taskId}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to remove delayed job for task ${taskId}: ${err}`);
    }

    try {
      await this.taskQueue.removeJobScheduler(`cron-${taskId}`);
      this.logger.log(`Removed job scheduler for task ${taskId}`);
    } catch {}

    this.logger.log(`Cancelled task ${taskId}`);
  }

  // Proactive follow-up → delayed job (one per user, auto-replaced)
  async scheduleProactive(userId: string, delayMinutes: number, message: string, channel: string): Promise<void> {
    await this.cancelProactive(userId);

    const delay = delayMinutes * 60 * 1000;
    await this.taskQueue.add(
      'proactive-delivery',
      { userId, message, channel },
      {
        delay,
        jobId: `proactive-${userId}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 20 },
      },
    );
    this.logger.log(`Scheduled proactive for user ${userId} (delay=${delayMinutes}min)`);
  }

  async cancelProactive(userId: string): Promise<void> {
    try {
      const job = await this.taskQueue.getJob(`proactive-${userId}`);
      if (job) {
        await job.remove();
        this.logger.log(`Cancelled pending proactive for user ${userId}`);
      }
    } catch (err) {
      this.logger.debug(`No pending proactive to cancel for user ${userId}: ${err}`);
    }
  }
}
