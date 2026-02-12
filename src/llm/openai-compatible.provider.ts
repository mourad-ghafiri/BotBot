import OpenAI from 'openai';
import { BaseOpenAIProvider } from './base-openai.provider';
import { LLMConfig } from '../config/config.types';

export class OpenAICompatibleProvider extends BaseOpenAIProvider {
  constructor(config: LLMConfig) {
    if (!config.base_url) {
      throw new Error('openai-compatible provider requires base_url');
    }
    const client = new OpenAI({
      apiKey: config.api_key || 'none',
      baseURL: config.base_url,
      maxRetries: 3,
      timeout: 120_000,
    });
    super(client, config.model, config.temperature, config.max_tokens);
  }
}
