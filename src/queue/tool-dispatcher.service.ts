import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { TOOL_JOBS_QUEUE, ToolJobData, ToolJobResult } from './tool-job.types';
import { parseRedisUrl } from '../utils/redis';

@Injectable()
export class ToolDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ToolDispatcherService.name);
  private toolQueue: Queue;
  private queueEvents: QueueEvents;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const connection = parseRedisUrl(this.config.get('queue.redis_url', 'redis://localhost:6379/0'));
    this.toolQueue = new Queue(TOOL_JOBS_QUEUE, { connection });
    this.queueEvents = new QueueEvents(TOOL_JOBS_QUEUE, { connection });
    await this.queueEvents.waitUntilReady();
    this.logger.log('ToolDispatcher ready');
  }

  async dispatch(data: ToolJobData, signal?: AbortSignal): Promise<ToolJobResult> {
    const job = await this.toolQueue.add('tool-exec', data, {
      priority: data.priority,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    });

    return new Promise<ToolJobResult>((resolve, reject) => {
      const onAbort = () => {
        job.remove().catch(() => {});
        reject(new Error('Cancelled'));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener('abort', onAbort, { once: true });

      job.waitUntilFinished(this.queueEvents)
        .then((result) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((err) => {
          signal?.removeEventListener('abort', onAbort);
          resolve({ content: `Error: ${err.message}`, isError: true });
        });
    });
  }

  async cancelByCorrelation(correlationId: string): Promise<void> {
    const waiting = await this.toolQueue.getWaiting();
    for (const j of waiting) {
      if (j.data?.correlationId === correlationId) {
        try { await j.remove(); } catch {}
      }
    }
    // Signal active workers via Redis pub/sub
    const client = await this.toolQueue.client;
    await client.publish(`botbot:cancel:${correlationId}`, 'cancel');
  }

  async onModuleDestroy(): Promise<void> {
    await this.toolQueue?.close();
    await this.queueEvents?.close();
  }
}
