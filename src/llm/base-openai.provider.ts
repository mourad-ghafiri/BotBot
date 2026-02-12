import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ILLMProvider } from './llm.interface';
import { ContentBlock, LLMMessage, LLMResponse, ToolCall, ToolDefinition } from './llm.types';

export abstract class BaseOpenAIProvider implements ILLMProvider {
  protected readonly client: OpenAI;
  protected readonly model: string;
  protected readonly temperature: number;
  protected readonly maxTokens: number;
  private readonly logger: Logger;

  private static readonly RETRY_MAX = 3;
  private static readonly RETRY_BASE_DELAY = 1000;
  private static readonly RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

  constructor(client: OpenAI, model: string, temperature: number, maxTokens: number) {
    this.client = client;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.logger = new Logger(`LLM:${this.constructor.name}`);
  }

  private isRetryable(err: any): boolean {
    if (err?.status && BaseOpenAIProvider.RETRYABLE_STATUS.has(err.status)) return true;
    const msg = (err?.message || '').toLowerCase();
    return msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket hang up');
  }

  async sendMessage(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    system?: string,
  ): Promise<LLMResponse> {
    const openaiMessages = this.buildMessages(messages, system);
    const openaiTools = tools?.length ? this.buildTools(tools) : undefined;

    const params: any = {
      model: this.model,
      messages: openaiMessages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
    if (openaiTools) params.tools = openaiTools;

    const lastMsg = messages[messages.length - 1];
    const lastPreview = typeof lastMsg?.content === 'string'
      ? lastMsg.content.slice(0, 500)
      : lastMsg?.toolCalls ? `[tool_calls: ${lastMsg.toolCalls.map(t => t.name).join(', ')}]` : '[content_blocks]';
    this.logger.debug(`>> Request | model=${this.model} | messages=${messages.length} | tools=${tools?.length ?? 0} | last ${lastMsg?.role}: ${lastPreview}`);

    let response: any;
    for (let attempt = 1; attempt <= BaseOpenAIProvider.RETRY_MAX; attempt++) {
      try {
        response = await this.client.chat.completions.create(params);
        break;
      } catch (err: any) {
        if (attempt < BaseOpenAIProvider.RETRY_MAX && this.isRetryable(err)) {
          const delay = BaseOpenAIProvider.RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
          this.logger.warn(`LLM retry ${attempt}/${BaseOpenAIProvider.RETRY_MAX} after ${delay}ms: ${err.message || err}`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
    const parsed = this.parseResponse(response);

    const replyPreview = typeof parsed.message.content === 'string'
      ? parsed.message.content.slice(0, 500)
      : '';
    const toolNames = parsed.message.toolCalls?.map(t => t.name).join(', ') || '';
    this.logger.debug(
      `<< Response | stop=${parsed.stopReason} | tokens=${parsed.usage.inputTokens ?? '?'}in/${parsed.usage.outputTokens ?? '?'}out` +
      (toolNames ? ` | tools=[${toolNames}]` : '') +
      (replyPreview ? ` | text="${replyPreview}"` : ''),
    );

    return parsed;
  }

  private buildMessages(messages: LLMMessage[], system?: string): any[] {
    const result: any[] = [];
    if (system) result.push({ role: 'system', content: system });

    for (const msg of messages) {
      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: msg.content ?? '',
          tool_call_id: msg.toolCallId ?? '',
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const tcList = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }));
        result.push({
          role: 'assistant',
          content: typeof msg.content === 'string' && msg.content.trim() ? msg.content : null,
          tool_calls: tcList,
        });
      } else if (msg.role === 'user' && Array.isArray(msg.content)) {
        result.push({ role: 'user', content: this.convertContentBlocks(msg.content) });
      } else {
        result.push({ role: msg.role, content: (typeof msg.content === 'string' ? msg.content : '') ?? '' });
      }
    }
    return result;
  }

  private convertContentBlocks(blocks: ContentBlock[]): any[] {
    return blocks.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'image':
          return { type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } };
        case 'audio':
          return { type: 'input_audio', input_audio: { data: block.data, format: block.mimeType.split('/')[1] || 'wav' } };
        case 'document':
          return { type: 'text', text: `[document: ${block.filename}]` };
      }
    });
  }

  private buildTools(tools: ToolDefinition[]): any[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  private parseResponse(response: any): LLMResponse {
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error(`LLM returned no choices. Response: ${JSON.stringify(response).slice(0, 500)}`);
    }
    const message = choice.message;

    let toolCalls: ToolCall[] | undefined;
    if (message.tool_calls?.length) {
      toolCalls = message.tool_calls.map((tc: any) => {
        let args = tc.function.arguments;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = { raw: args }; }
        }
        return { id: tc.id, name: tc.function.name, arguments: args };
      });
    }

    let stopReason: LLMResponse['stopReason'] = 'end_turn';
    if (choice.finish_reason === 'tool_calls' || toolCalls?.length) {
      stopReason = 'tool_use';
    } else if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens';
    }

    const usage: LLMResponse['usage'] = {};
    if (response.usage) {
      usage.inputTokens = response.usage.prompt_tokens;
      usage.outputTokens = response.usage.completion_tokens;
    }

    return {
      message: {
        role: 'assistant',
        content: message.content ?? undefined,
        toolCalls,
      },
      stopReason,
      usage,
    };
  }
}
