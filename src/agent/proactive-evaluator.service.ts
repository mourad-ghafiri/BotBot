import { Inject, Injectable, Logger } from '@nestjs/common';
import { ILLMProvider, LLM_PROVIDER } from '../llm/llm.interface';
import { LLMMessage, getTextContent } from '../llm/llm.types';
import { TaskService } from '../task/task.service';

const MIN_DELAY = 30;
const MAX_DELAY = 1440;

@Injectable()
export class ProactiveEvaluatorService {
  private readonly logger = new Logger(ProactiveEvaluatorService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: ILLMProvider,
    private readonly taskService: TaskService,
  ) {}

  async evaluate(context: {
    recentHistory: LLMMessage[];
    memoryContext: string;
    currentTime: string;
  }): Promise<{ delayMinutes: number; message: string } | null> {
    const pendingTasks = await this.getPendingTasksSummary();

    const historyStr = context.recentHistory
      .filter((m) => m.role !== 'tool')
      .map((m) => `${m.role}: ${(typeof m.content === 'string' ? m.content : '').slice(0, 300)}`)
      .join('\n');

    const parts = [
      `You are deciding whether to proactively follow up with the user later.`,
      `Current time: ${context.currentTime}`,
      '',
      `## Recent conversation:`,
      historyStr,
    ];

    if (context.memoryContext) {
      parts.push('', `## What you know about the user:`, context.memoryContext);
    }
    if (pendingTasks) {
      parts.push('', `## Their pending tasks:`, pendingTasks);
    }

    parts.push(
      '',
      `Based on the conversation, decide if you should proactively follow up later.`,
      `Only follow up if there's something genuinely useful — a check-in on progress, a reminder, a helpful thought, etc.`,
      `Do NOT follow up for trivial exchanges, greetings, or when the conversation reached a natural conclusion.`,
      '',
      `If you should NOT follow up, respond with exactly: [SKIP]`,
      `If you SHOULD follow up, respond with a JSON object (no markdown fencing):`,
      `{"delay_minutes": <30-1440>, "message": "<your follow-up message>"}`,
    );

    const prompt = parts.join('\n');

    const response = await this.llm.sendMessage(
      [{ role: 'user', content: prompt }],
      undefined,
      'You are a proactive assistant deciding when to follow up. Respond only with [SKIP] or a JSON object.',
    );

    const text = getTextContent(response.message).trim();

    if (!text || text.includes('[SKIP]')) {
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.delay_minutes !== 'number' || typeof parsed.message !== 'string') {
        this.logger.warn(`Invalid proactive eval response structure: ${text.slice(0, 200)}`);
        return null;
      }

      const delay = Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.round(parsed.delay_minutes)));
      return { delayMinutes: delay, message: parsed.message };
    } catch {
      this.logger.warn(`Failed to parse proactive eval response: ${text.slice(0, 200)}`);
      return null;
    }
  }

  private async getPendingTasksSummary(): Promise<string> {
    try {
      const pending = await this.taskService.listTasks('pending');
      const scheduled = await this.taskService.listTasks('scheduled');
      const all = [...pending, ...scheduled].slice(0, 8);
      if (!all.length) return '';
      return all
        .map((t) => `- [${t.status}] ${t.title}${t.scheduledAt ? ` (${t.scheduledAt})` : ''}`)
        .join('\n');
    } catch {
      return '';
    }
  }
}
