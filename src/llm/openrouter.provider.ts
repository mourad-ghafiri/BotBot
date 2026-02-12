import OpenAI from 'openai';
import { BaseOpenAIProvider } from './base-openai.provider';
import { LLMConfig } from '../config/config.types';

export class OpenRouterProvider extends BaseOpenAIProvider {
  constructor(config: LLMConfig) {
    const client = new OpenAI({
      apiKey: config.api_key,
      baseURL: config.base_url || 'https://openrouter.ai/api/v1',
      maxRetries: 3,
      timeout: 120_000,
    });
    super(client, config.model, config.temperature, config.max_tokens);
  }
}
