export interface ProviderDefaults {
  base_url?: string;
  requires_api_key: boolean;
  default_model: string;
  needs_base_url?: boolean;
}

export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  openai:              { base_url: 'https://api.openai.com/v1',                                requires_api_key: true,  default_model: 'gpt-4o' },
  openrouter:          { base_url: 'https://openrouter.ai/api/v1',                             requires_api_key: true,  default_model: 'anthropic/claude-sonnet-4' },
  ollama:              { base_url: 'http://localhost:11434/v1',                                 requires_api_key: false, default_model: 'llama3.1' },
  anthropic:           {                                                                        requires_api_key: true,  default_model: 'claude-sonnet-4-20250514' },
  groq:                { base_url: 'https://api.groq.com/openai/v1',                           requires_api_key: true,  default_model: 'llama-3.3-70b-versatile' },
  together:            { base_url: 'https://api.together.xyz/v1',                              requires_api_key: true,  default_model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  deepseek:            { base_url: 'https://api.deepseek.com',                                 requires_api_key: true,  default_model: 'deepseek-chat' },
  gemini:              { base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',  requires_api_key: true,  default_model: 'gemini-2.0-flash' },
  azure:               {                                                                        requires_api_key: true,  default_model: 'gpt-4o', needs_base_url: true },
  'openai-compatible': {                                                                        requires_api_key: false, default_model: 'gpt-4o',  needs_base_url: true },
};

export const VALID_PROVIDERS = Object.keys(PROVIDER_DEFAULTS);
