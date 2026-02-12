import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job as BullJob } from 'bullmq';
import { TOOL_JOBS_QUEUE, ToolJobData, ToolJobResult } from './tool-job.types';
import { SkillRegistryService } from '../skills/skill-registry.service';

@Processor(TOOL_JOBS_QUEUE)
export class ToolProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ToolProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly skillRegistry: SkillRegistryService,
  ) {
    super();
  }

  onModuleInit(): void {
    const envConcurrency = process.env.BOTBOT_CONCURRENCY ? parseInt(process.env.BOTBOT_CONCURRENCY, 10) : null;
    const concurrency = envConcurrency ?? this.config.get<number>('queue.tool_concurrency', 3);
    this.worker.concurrency = concurrency;
    this.logger.log(`ToolProcessor concurrency set to ${concurrency}`);
  }

  async process(job: BullJob<ToolJobData>): Promise<ToolJobResult> {
    const { skillName, toolName, args, correlationId } = job.data;
    this.logger.log(`Processing: ${skillName}/${toolName} (corr=${correlationId}) | args=${JSON.stringify(args).slice(0, 200)}`);
    const start = Date.now();

    try {
      const content = await this.skillRegistry.execute(toolName, args);
      this.logger.log(`Done: ${skillName}/${toolName} (corr=${correlationId}) | ${Date.now() - start}ms | ok | ${content.length} chars`);
      return { content, isError: false };
    } catch (err: any) {
      this.logger.error(`Done: ${skillName}/${toolName} (corr=${correlationId}) | ${Date.now() - start}ms | ERROR | ${String(err.message || err).slice(0, 300)}`);
      return { content: `Error: ${err.message || err}`, isError: true };
    }
  }
}
