import { Logger } from '@nestjs/common';
import { ILLMProvider } from './llm.interface';
import { LLMMessage, LLMResponse, ToolDefinition } from './llm.types';

export class LoadBalancedProvider implements ILLMProvider {
  private readonly logger = new Logger(LoadBalancedProvider.name);
  private index = 0;

  constructor(
    private readonly providers: ILLMProvider[],
    private readonly labels: string[],
  ) {
    if (providers.length === 0) {
      throw new Error('LoadBalancedProvider requires at least one provider');
    }
  }

  async sendMessage(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    system?: string,
  ): Promise<LLMResponse> {
    // Single-provider fast path
    if (this.providers.length === 1) {
      return this.providers[0].sendMessage(messages, tools, system);
    }

    const startIndex = this.index;
    this.index = (this.index + 1) % this.providers.length;

    const failures: { label: string; error: Error }[] = [];

    // Try the selected provider first, then remaining in order
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (startIndex + i) % this.providers.length;
      const provider = this.providers[idx];
      const label = this.labels[idx];

      try {
        const response = await provider.sendMessage(messages, tools, system);
        if (i > 0) {
          this.logger.warn(`Failover succeeded on ${label} (after ${i} failure(s))`);
        }
        return response;
      } catch (err: any) {
        failures.push({ label, error: err });
        this.logger.warn(`Provider ${label} failed: ${err.message}`);
      }
    }

    throw new Error(
      `All ${this.providers.length} LLM providers failed:\n` +
        failures.map((f) => `  [${f.label}] ${f.error.message}`).join('\n'),
    );
  }
}
