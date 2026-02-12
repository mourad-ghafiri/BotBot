import { AzureOpenAI } from 'openai';
import { BaseOpenAIProvider } from './base-openai.provider';
import { LLMConfig } from '../config/config.types';

export class AzureProvider extends BaseOpenAIProvider {
  constructor(config: LLMConfig) {
    if (!config.base_url) {
      throw new Error('Azure provider requires base_url (your Azure endpoint, e.g. https://my-resource.openai.azure.com)');
    }
    const client = new AzureOpenAI({
      apiKey: config.api_key,
      endpoint: config.base_url,
      apiVersion: config.api_version || '2024-10-21',
      maxRetries: 3,
      timeout: 120_000,
    });
    super(client, config.model, config.temperature, config.max_tokens);
  }
}
