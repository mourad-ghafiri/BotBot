import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ILLMProvider } from './llm.interface';
import { ContentBlock, LLMMessage, LLMResponse, ToolCall, ToolDefinition } from './llm.types';
import { LLMConfig } from '../config/config.types';

export class AnthropicProvider implements ILLMProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({
      apiKey: config.api_key,
      maxRetries: 3,
      timeout: 120_000,
    });
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.max_tokens;
  }

  async sendMessage(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    system?: string,
  ): Promise<LLMResponse> {
    const anthropicMessages = this.buildMessages(messages);
    const params: any = {
      model: this.model,
      messages: anthropicMessages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };
    if (system) params.system = system;
    if (tools?.length) params.tools = this.buildTools(tools);

    const lastMsg = messages[messages.length - 1];
    const lastPreview = typeof lastMsg?.content === 'string'
      ? lastMsg.content.slice(0, 500)
      : lastMsg?.toolCalls ? `[tool_calls: ${lastMsg.toolCalls.map(t => t.name).join(', ')}]` : '[content_blocks]';
    this.logger.debug(`>> Request | model=${this.model} | messages=${messages.length} | tools=${tools?.length ?? 0} | last ${lastMsg?.role}: ${lastPreview}`);

    const response = await this.client.messages.create(params);
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

  private buildMessages(messages: LLMMessage[]): any[] {
    const result: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'tool') {
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId ?? '',
              content: msg.content ?? '',
            },
          ],
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const contentBlocks: any[] = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        result.push({ role: 'assistant', content: contentBlocks });
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
          return { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } };
        case 'document':
          return { type: 'document', source: { type: 'base64', media_type: block.mimeType, data: block.data } };
        case 'audio':
          return { type: 'text', text: '[audio attachment]' };
      }
    });
  }

  private buildTools(tools: ToolDefinition[]): any[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  private parseResponse(data: any): LLMResponse {
    const contentBlocks = data.content || [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    let stopReason: LLMResponse['stopReason'] = 'end_turn';
    if (data.stop_reason === 'tool_use') stopReason = 'tool_use';
    else if (data.stop_reason === 'max_tokens') stopReason = 'max_tokens';

    const usage: LLMResponse['usage'] = {};
    if (data.usage) {
      usage.inputTokens = data.usage.input_tokens;
      usage.outputTokens = data.usage.output_tokens;
    }

    return {
      message: {
        role: 'assistant',
        content: textParts.length ? textParts.join('\n') : undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      },
      stopReason,
      usage,
    };
  }
}
