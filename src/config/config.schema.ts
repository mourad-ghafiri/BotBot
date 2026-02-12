import * as Joi from 'joi';
import { VALID_PROVIDERS } from '../llm/provider-defaults';

const llmObjectSchema = Joi.object({
  provider: Joi.string().valid(...VALID_PROVIDERS).default('openrouter'),
  api_key: Joi.string().allow('').optional().default(''),
  model: Joi.string().required(),
  temperature: Joi.number().min(0).max(2).default(0.7),
  max_tokens: Joi.number().integer().min(1).default(4096),
  base_url: Joi.string().uri().optional(),
  api_version: Joi.string().optional(),
  photo_enabled: Joi.boolean().default(false),
  audio_enabled: Joi.boolean().default(false),
  video_enabled: Joi.boolean().default(false),
  document_enabled: Joi.boolean().default(false),
  tool_enabled: Joi.boolean().default(true),
});

export const configValidationSchema = Joi.object({
  llm: Joi.alternatives()
    .try(llmObjectSchema, Joi.array().items(llmObjectSchema).min(1))
    .required(),

  agent: Joi.object({
    workspace: Joi.string().default('workspace'),
    max_iterations: Joi.number().integer().min(1).default(150),
    max_input_length: Joi.number().integer().min(100).default(4096),
    history_limit: Joi.number().integer().min(1).default(100),
    security: Joi.object({
      enabled: Joi.boolean().default(true),
    }).default(),
    memory: Joi.object({
      auto_retrieval: Joi.boolean().default(true),
      auto_extraction: Joi.boolean().default(true),
      retrieval_limit: Joi.number().integer().min(1).default(5),
    }).default(),
    proactive: Joi.object({
      enabled: Joi.boolean().default(false),
    }).default(),
  }).required(),

  server: Joi.object({
    enabled: Joi.boolean().default(false),
    ip: Joi.string().default('0.0.0.0'),
    port: Joi.number().integer().default(3000),
    apiKey: Joi.string().allow('').default(''),
  }).default(),

  channel: Joi.object({
    webhook: Joi.object({
      enabled: Joi.boolean().default(false),
      callback_url: Joi.string().uri().allow('').default(''),
      secret: Joi.string().allow('').default(''),
    }).default(),
    telegram: Joi.object({
      enabled: Joi.boolean().default(false),
      token: Joi.string().allow('').default(''),
      allowed_users: Joi.array().items(Joi.number().integer()).default([]),
      rate_limit_window: Joi.number().integer().min(1000).default(60000),
      rate_limit_max: Joi.number().integer().min(1).default(10),
    }).default(),
    whatsapp: Joi.object({
      enabled: Joi.boolean().default(false),
      allowed_numbers: Joi.array().items(Joi.string()).default([]),
    }).default(),
  }).default(),

  queue: Joi.object({
    redis_url: Joi.string().default('redis://localhost:6379/0'),
    key_prefix: Joi.string().default('botbot:'),
    agent_concurrency: Joi.number().integer().min(1).default(3),
    tool_concurrency: Joi.number().integer().min(1).default(3),
    task_concurrency: Joi.number().integer().min(1).default(3),
  }).default(),

  skills: Joi.object().pattern(
    Joi.string(),
    Joi.object({
      enabled: Joi.boolean().default(true),
    }).unknown(true),
  ).default({}),
});
