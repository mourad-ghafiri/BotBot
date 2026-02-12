export interface LLMConfig {
  provider: string;
  api_key?: string;
  model: string;
  temperature: number;
  max_tokens: number;
  base_url?: string;
  api_version?: string;
  photo_enabled: boolean;
  audio_enabled: boolean;
  video_enabled: boolean;
  document_enabled: boolean;
  tool_enabled: boolean;
}

export interface SecurityConfig {
  enabled: boolean;
}

export interface MemoryConfig {
  auto_retrieval: boolean;
  auto_extraction: boolean;
  retrieval_limit: number;
}

export interface ProactiveConfig {
  enabled: boolean;
}

export interface AgentConfig {
  workspace: string;
  max_iterations: number;
  max_input_length: number;
  history_limit: number;
  security: SecurityConfig;
  memory: MemoryConfig;
  proactive: ProactiveConfig;
}

export interface ServerConfig {
  enabled: boolean;
  ip: string;
  port: number;
  apiKey?: string;
}

export interface WebhookChannelConfig {
  enabled: boolean;
  callback_url: string;
  secret?: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  token: string;
  allowed_users: number[];
  rate_limit_window: number;
  rate_limit_max: number;
}

export interface WhatsAppChannelConfig {
  enabled: boolean;
  allowed_numbers: string[];
}

export interface ChannelConfig {
  webhook: WebhookChannelConfig;
  telegram: TelegramChannelConfig;
  whatsapp: WhatsAppChannelConfig;
}

export interface QueueConfig {
  redis_url: string;
  key_prefix: string;
  agent_concurrency: number;
  tool_concurrency: number;
  task_concurrency: number;
}

export interface SkillConfig {
  enabled: boolean;
  [key: string]: any;
}

export interface SkillsConfig {
  [name: string]: SkillConfig;
}

export interface AppConfig {
  llm: LLMConfig | LLMConfig[];
  agent: AgentConfig;
  server: ServerConfig;
  channel: ChannelConfig;
  queue: QueueConfig;
  skills: SkillsConfig;
}
