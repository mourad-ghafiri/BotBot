import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job as BullJob } from 'bullmq';
import { AGENT_JOBS_QUEUE, AgentJobData, AgentJobResult } from './agent-job.types';
import { AgentService } from '../agent/agent.service';

@Processor(AGENT_JOBS_QUEUE)
export class AgentProcessor extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentProcessor.name);
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeToolControllers = new Map<string, AbortController>();

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AgentService))
    private readonly agentService: AgentService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.BOTBOT_WORKER_MODE) {
      await this.worker.pause();
      this.logger.log('AgentProcessor paused (worker mode)');
      return;
    }
    const concurrency = this.config.get('queue.agent_concurrency', 3);
    this.worker.concurrency = concurrency;
    this.logger.log(`AgentProcessor concurrency set to ${concurrency}`);
  }

  async process(job: BullJob<AgentJobData>): Promise<AgentJobResult> {
    const data = job.data;
    const userId = data.userId || 'anon';

    const ac = new AbortController();
    const toolAc = new AbortController();
    this.activeControllers.set(userId, ac);
    this.activeToolControllers.set(userId, toolAc);

    try {
      const result = await this.agentService.run({
        userMessage: data.userMessage,
        userId: data.userId,
        channel: data.channel,
        priority: data.priority,
        skipSecurity: data.skipSecurity,
        disableTaskTools: data.disableTaskTools,
        activateAllSkills: data.activateAllSkills,
        signal: ac.signal,
        getToolSignal: () => this.activeToolControllers.get(userId)?.signal,
        progressCallback: async (text: string) => {
          await job.updateProgress({ text });
        },
      });
      return { text: result.text, files: result.files };
    } finally {
      this.activeControllers.delete(userId);
      this.activeToolControllers.delete(userId);
    }
  }

  cancelForUser(userId: string): void {
    const ac = this.activeControllers.get(userId);
    if (ac) {
      ac.abort();
      this.activeControllers.delete(userId);
    }
    const tc = this.activeToolControllers.get(userId);
    if (tc) {
      tc.abort();
      this.activeToolControllers.delete(userId);
    }
  }

  stopForUser(userId: string): void {
    const tc = this.activeToolControllers.get(userId);
    if (tc) {
      tc.abort();
      this.activeToolControllers.set(userId, new AbortController());
    }
  }

  onModuleDestroy(): void {
    for (const [, ac] of this.activeControllers) ac.abort();
    this.activeControllers.clear();
    for (const [, ac] of this.activeToolControllers) ac.abort();
    this.activeToolControllers.clear();
  }
}
