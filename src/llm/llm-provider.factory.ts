import { LLMConfig } from '../config/config.types';
import { ILLMProvider } from './llm.interface';
import { PROVIDER_DEFAULTS } from './provider-defaults';
import { OpenAIProvider } from './openai.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { OllamaProvider } from './ollama.provider';
import { AzureProvider } from './azure.provider';
import { GroqProvider } from './groq.provider';
import { TogetherProvider } from './together.provider';
import { DeepSeekProvider } from './deepseek.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AnthropicProvider } from './anthropic.provider';
import { LoadBalancedProvider } from './load-balanced.provider';

export function createLoadBalancedProvider(
  config: LLMConfig | LLMConfig[],
): ILLMProvider {
  const configs = Array.isArray(config) ? config : [config];

  if (configs.length === 1) {
    return createLLMProvider(configs[0]);
  }

  const providers = configs.map((c) => createLLMProvider(c));
  const labels = configs.map((c) => `${c.provider}/${c.model}`);
  return new LoadBalancedProvider(providers, labels);
}

export function createLLMProvider(config: LLMConfig): ILLMProvider {
  const provider = (config.provider || 'openrouter').toLowerCase();

  const defaults = PROVIDER_DEFAULTS[provider];
  if (!defaults) {
    throw new Error(`Unknown LLM provider: ${provider}. Valid providers: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`);
  }

  if (defaults.requires_api_key && !config.api_key) {
    throw new Error(`Provider '${provider}' requires an api_key`);
  }

  switch (provider) {
    case 'openai':              return new OpenAIProvider(config);
    case 'openrouter':          return new OpenRouterProvider(config);
    case 'ollama':              return new OllamaProvider(config);
    case 'azure':               return new AzureProvider(config);
    case 'groq':                return new GroqProvider(config);
    case 'together':            return new TogetherProvider(config);
    case 'deepseek':            return new DeepSeekProvider(config);
    case 'gemini':              return new GeminiProvider(config);
    case 'openai-compatible':   return new OpenAICompatibleProvider(config);
    case 'anthropic':           return new AnthropicProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
