import { Injectable, Inject, Logger } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { ILLMProvider, LLM_PROVIDER } from '../llm/llm.interface';
import { LLMMessage, ToolDefinition } from '../llm/llm.types';

const EXTRACT_TOOL: ToolDefinition = {
  name: 'store_facts',
  description: 'Store one or more facts extracted from the conversation. Call once with all facts.',
  input_schema: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'A clear, standalone sentence describing the fact.' },
            category: {
              type: 'string',
              enum: ['personal', 'preference', 'project', 'decision', 'system', 'general'],
            },
            tags: { type: 'array', items: { type: 'string' } },
            importance: {
              type: 'number',
              description: '0.3 minor, 0.5 general, 0.7 important, 0.9 critical.',
            },
          },
          required: ['content', 'category', 'importance'],
        },
      },
    },
    required: ['facts'],
  },
};

const EXTRACTION_SYSTEM =
  'You extract facts worth remembering from conversations. ' +
  'Call the store_facts tool with any new facts. ' +
  'If nothing is worth storing, call store_facts with an empty array.';

@Injectable()
export class MemoryExtractionService {
  private readonly logger = new Logger(MemoryExtractionService.name);

  constructor(
    private readonly memoryService: MemoryService,
    @Inject(LLM_PROVIDER) private readonly llm: ILLMProvider,
  ) {}

  shouldSkipExtraction(message: string): boolean {
    const stripped = message.trim();
    if (stripped.length < 10) return true;
    if (stripped.startsWith('/')) return true;
    return false;
  }

  memoryStoreWasUsed(history: LLMMessage[], turnStart: number): boolean {
    for (const msg of history.slice(turnStart)) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      if (msg.toolCalls.some((tc) => tc.name === 'memory_store')) return true;
    }
    return false;
  }

  async autoExtractMemories(
    userMessage: string,
    history: LLMMessage[],
    turnStart: number,
  ): Promise<void> {
    if (this.shouldSkipExtraction(userMessage)) return;

    try {
      const existing = await this.memoryService.retrieve(userMessage, 10);
      const existingBlock = existing.length
        ? existing.map((m) => `- ${m.content}`).join('\n')
        : '(none)';

      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant' && m.content);
      const responseSnippet = lastAssistant?.content?.slice(0, 300) ?? '';

      const actions = this.summarizeTurnActions(history, turnStart);

      const prompt =
        `Extract facts worth remembering long-term from this conversation turn.\n\n` +
        `User: "${userMessage}"\n` +
        (responseSnippet ? `Assistant: "${responseSnippet}"\n` : '') +
        (actions ? `Actions taken:\n${actions}\n` : '') +
        `\nAlready known:\n${existingBlock}\n\n` +
        `Rules:\n` +
        `- Only NEW facts not already known\n` +
        `- Store: user preferences, personal details, project info, decisions, system changes, skills created\n` +
        `- Do NOT store: greetings, transient commands, questions, trivial actions`;

      const response = await this.llm.sendMessage(
        [{ role: 'user', content: prompt }],
        [EXTRACT_TOOL],
        EXTRACTION_SYSTEM,
      );

      // LLM returns structured tool calls — no string parsing needed
      const toolCalls = response.message.toolCalls;
      if (!toolCalls?.length) return;

      for (const tc of toolCalls) {
        if (tc.name !== 'store_facts') continue;
        const facts = tc.arguments.facts;
        if (!Array.isArray(facts)) continue;

        for (const fact of facts) {
          if (!fact?.content) continue;

          const similar = await this.memoryService.findSimilar(fact.content, 0.6, 1);
          if (similar.length > 0) {
            this.logger.debug(`Skipping duplicate: "${fact.content.slice(0, 60)}"`);
            continue;
          }

          await this.memoryService.store(
            fact.content,
            fact.category || 'general',
            fact.tags || [],
            {},
            'auto-extracted',
            fact.importance ?? 0.5,
          );
          this.logger.log(`Auto-extracted: ${fact.content.slice(0, 100)}`);
        }
      }
    } catch (err) {
      this.logger.debug(`Auto memory extraction failed (non-fatal): ${err}`);
    }
  }

  private summarizeTurnActions(history: LLMMessage[], turnStart: number): string {
    const actions: string[] = [];
    for (const msg of history.slice(turnStart)) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        if (tc.name.startsWith('memory_')) continue;
        const brief: Record<string, string> = {};
        for (const [k, v] of Object.entries(tc.arguments)) {
          const s = String(v);
          brief[k] = s.length > 100 ? s.slice(0, 100) + '...' : s;
        }
        actions.push(`- ${tc.name}(${JSON.stringify(brief)})`);
      }
    }
    return actions.join('\n');
  }
}
