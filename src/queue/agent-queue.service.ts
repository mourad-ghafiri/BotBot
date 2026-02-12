import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { AGENT_JOBS_QUEUE, AgentJobData, AgentJobResult } from './agent-job.types';
import { AgentProcessor } from './agent.processor';
import { parseRedisUrl } from '../utils/redis';

export interface EnqueueOptions {
  onProgress?: (text: string) => Promise<void>;
}

interface PendingCaller {
  jobId: string;
  reject: (err: Error) => void;
}

@Injectable()
export class AgentQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentQueueService.name);
  private queueEvents: QueueEvents;
  private readonly pendingCallers = new Map<string, PendingCaller[]>();

  constructor(
    @InjectQueue(AGENT_JOBS_QUEUE) private readonly queue: Queue,
    private readonly agentProcessor: AgentProcessor,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.BOTBOT_WORKER_MODE) {
      this.logger.log('AgentQueue skipped (worker mode)');
      return;
    }
    const connection = parseRedisUrl(this.config.get('queue.redis_url', 'redis://localhost:6379/0'));
    this.queueEvents = new QueueEvents(AGENT_JOBS_QUEUE, { connection });
    await this.queueEvents.waitUntilReady();
    this.logger.log('AgentQueue ready');
  }

  async enqueue(data: AgentJobData, options?: EnqueueOptions): Promise<AgentJobResult> {
    const job = await this.queue.add('agent-run', data, {
      priority: data.priority,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    });

    const userId = data.userId || 'anon';

    return new Promise<AgentJobResult>((resolve, reject) => {
      // Track for cancellation
      const pending: PendingCaller = { jobId: job.id!, reject };
      if (!this.pendingCallers.has(userId)) {
        this.pendingCallers.set(userId, []);
      }
      this.pendingCallers.get(userId)!.push(pending);

      // Listen for progress events (intermediate text)
      const progressHandler = ({ jobId, data: progressData }: { jobId: string; data: any }) => {
        if (jobId === job.id && options?.onProgress && progressData?.text) {
          options.onProgress(progressData.text).catch(() => {});
        }
      };

      this.queueEvents.on('progress', progressHandler);

      const cleanup = () => {
        this.queueEvents.removeListener('progress', progressHandler);
        const callers = this.pendingCallers.get(userId);
        if (callers) {
          const idx = callers.indexOf(pending);
          if (idx !== -1) callers.splice(idx, 1);
          if (callers.length === 0) this.pendingCallers.delete(userId);
        }
      };

      job.waitUntilFinished(this.queueEvents)
        .then((result) => {
          cleanup();
          resolve(result);
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }

  stopForUser(userId: string): void {
    this.agentProcessor.stopForUser(userId);
    this.logger.log(`Stopped current tool execution for user ${userId}`);
  }

  async cancelForUser(userId: string): Promise<void> {
    // Abort active job in processor
    this.agentProcessor.cancelForUser(userId);

    // Reject all pending callers for this user
    const callers = this.pendingCallers.get(userId);
    if (callers) {
      for (const caller of callers) {
        caller.reject(new Error('Cancelled'));
      }
      this.pendingCallers.delete(userId);
    }

    // Remove queued (waiting) jobs for this user
    const waiting = await this.queue.getWaiting();
    for (const j of waiting) {
      if (j.data?.userId === userId) {
        try { await j.remove(); } catch {}
      }
    }

    this.logger.log(`Cancelled agent processing for user ${userId}`);
  }

  async onModuleDestroy(): Promise<void> {
    // Reject all pending callers
    for (const [, callers] of this.pendingCallers) {
      for (const caller of callers) {
        caller.reject(new Error('AgentQueueService shutting down'));
      }
    }
    this.pendingCallers.clear();
    await this.queueEvents?.close();
  }
}
