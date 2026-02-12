import * as p from '@clack/prompts';
import pc from 'picocolors';
import * as fs from 'fs';
import { CONFIG_PATH, PID_FILE } from './paths';
import { configValidationSchema } from '../config/config.schema';
import { VALID_PROVIDERS, PROVIDER_DEFAULTS } from '../llm/provider-defaults';
import { readPidFile, isRunning, listWorkerIds } from './process-utils';
import { workerPidFile } from './paths';
import type { AppConfig, LLMConfig, SkillsConfig } from '../config/config.types';

// ── Helpers ─────────────────────────────────────────────────

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel('Config editor cancelled.');
    process.exit(0);
  }
}

function maskSecret(value: string | undefined): string {
  if (!value) return pc.dim('(not set)');
  if (value.length <= 6) return '*'.repeat(value.length);
  return value.slice(0, 4) + '****';
}

function formatBoolean(value: boolean | undefined): string {
  return value ? pc.green('enabled') : pc.dim('disabled');
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ── Display ─────────────────────────────────────────────────

function normalizeLLM(llm: LLMConfig | LLMConfig[]): LLMConfig[] {
  return Array.isArray(llm) ? llm : [llm];
}

function displayConfigOverview(config: AppConfig): void {
  const llms = normalizeLLM(config.llm);

  const llmLines = llms.map((l, i) => {
    const label = llms.length > 1 ? `  Provider [${i + 1}]:` : '  Provider:';
    return `${pc.bold(label.padEnd(18))} ${l.provider} / ${l.model}\n` +
      `${''.padEnd(18)} API key: ${maskSecret(l.api_key)}`;
  }).join('\n');

  const { agent, server, channel, queue, skills } = config;

  const sections = [
    `${pc.bold(pc.cyan('LLM'))}\n${llmLines}`,
    `${pc.bold(pc.cyan('Agent'))}\n` +
    `  Workspace:       ${agent.workspace}\n` +
    `  Max iterations:  ${agent.max_iterations}\n` +
    `  History limit:   ${agent.history_limit}\n` +
    `  Security:        ${formatBoolean(agent.security?.enabled)}\n` +
    `  Memory:          ${formatBoolean(agent.memory?.auto_retrieval)}\n` +
    `  Proactive:       ${formatBoolean(agent.proactive?.enabled)}`,
    `${pc.bold(pc.cyan('Server'))}\n` +
    `  Status:          ${formatBoolean(server.enabled)}\n` +
    `  Address:         ${server.ip}:${server.port}\n` +
    `  API key:         ${maskSecret(server.apiKey)}`,
    `${pc.bold(pc.cyan('Channels'))}\n` +
    `  Telegram:        ${formatBoolean(channel.telegram?.enabled)}\n` +
    `  WhatsApp:        ${formatBoolean(channel.whatsapp?.enabled)}\n` +
    `  Webhook:         ${formatBoolean(channel.webhook?.enabled)}`,
    `${pc.bold(pc.cyan('Queue'))}\n` +
    `  Redis:           ${queue.redis_url}\n` +
    `  Key prefix:      ${queue.key_prefix}\n` +
    `  Concurrency:     agent=${queue.agent_concurrency} tool=${queue.tool_concurrency} task=${queue.task_concurrency}`,
    `${pc.bold(pc.cyan('Skills'))}\n` +
    Object.entries(skills || {}).map(([name, cfg]) =>
      `  ${name.padEnd(16)} ${formatBoolean(cfg.enabled)}`
    ).join('\n'),
  ];

  p.note(sections.join('\n\n'), 'Current Configuration');
}

// ── Section Editors ─────────────────────────────────────────

async function editSingleLLM(llm: LLMConfig): Promise<LLMConfig> {
  const result = { ...llm };

  const provider = await p.select({
    message: 'Provider',
    options: VALID_PROVIDERS.map((id) => ({ value: id, label: id })),
    initialValue: result.provider,
  });
  handleCancel(provider);
  result.provider = provider as string;

  const defaults = PROVIDER_DEFAULTS[result.provider];

  const apiKey = await p.password({
    message: `API key ${result.api_key ? pc.dim(`(current: ${maskSecret(result.api_key)}, enter to keep)`) : ''}`,
  });
  handleCancel(apiKey);
  if (apiKey) result.api_key = apiKey as string;

  const model = await p.text({
    message: 'Model',
    defaultValue: result.model || defaults?.default_model || '',
    placeholder: defaults?.default_model || '',
  });
  handleCancel(model);
  result.model = model as string;

  const temperature = await p.text({
    message: 'Temperature',
    defaultValue: String(result.temperature ?? 0.7),
    validate: (v) => {
      if (!v) return;
      const n = parseFloat(v);
      if (isNaN(n) || n < 0 || n > 2) return 'Must be between 0 and 2';
    },
  });
  handleCancel(temperature);
  result.temperature = parseFloat(temperature as string);

  const maxTokens = await p.text({
    message: 'Max tokens',
    defaultValue: String(result.max_tokens ?? 4096),
    validate: (v) => {
      if (!v) return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return 'Must be a positive integer';
    },
  });
  handleCancel(maxTokens);
  result.max_tokens = parseInt(maxTokens as string, 10);

  if (defaults?.needs_base_url || result.base_url) {
    const baseUrl = await p.text({
      message: 'Base URL',
      defaultValue: result.base_url || defaults?.base_url || '',
      placeholder: defaults?.base_url || 'https://your-endpoint.com/v1',
    });
    handleCancel(baseUrl);
    if (baseUrl) result.base_url = baseUrl as string;
  }

  const toolEnabled = await p.confirm({
    message: 'Tool use enabled?',
    initialValue: result.tool_enabled ?? true,
  });
  handleCancel(toolEnabled);
  result.tool_enabled = toolEnabled as boolean;

  return result;
}

async function editLLMSection(llm: LLMConfig | LLMConfig[]): Promise<LLMConfig | LLMConfig[]> {
  const providers = normalizeLLM(deepClone(llm));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const options: { value: string; label: string }[] = providers.map((pr, i) => ({
      value: `edit-${i}`,
      label: `Edit: ${pr.provider} / ${pr.model}`,
    }));
    options.push({ value: 'add', label: 'Add new provider' });
    if (providers.length > 1) {
      options.push({ value: 'remove', label: 'Remove a provider' });
    }
    options.push({ value: 'back', label: 'Back' });

    const action = await p.select({ message: 'LLM Providers', options });
    handleCancel(action);

    if (action === 'back') break;

    if (action === 'add') {
      const providerDefaults = PROVIDER_DEFAULTS['openrouter'];
      const newLlm: LLMConfig = {
        provider: 'openrouter',
        model: providerDefaults.default_model,
        temperature: 0.7,
        max_tokens: 4096,
        photo_enabled: false,
        audio_enabled: false,
        video_enabled: false,
        document_enabled: false,
        tool_enabled: true,
      };
      const edited = await editSingleLLM(newLlm);
      providers.push(edited);
      continue;
    }

    if (action === 'remove') {
      const removeIdx = await p.select({
        message: 'Remove which provider?',
        options: providers.map((pr, i) => ({
          value: String(i),
          label: `${pr.provider} / ${pr.model}`,
        })),
      });
      handleCancel(removeIdx);
      providers.splice(parseInt(removeIdx as string, 10), 1);
      continue;
    }

    // edit-N
    const idx = parseInt((action as string).replace('edit-', ''), 10);
    providers[idx] = await editSingleLLM(providers[idx]);
  }

  return providers.length === 1 ? providers[0] : providers;
}

async function editAgentSection(agent: AppConfig['agent']): Promise<AppConfig['agent']> {
  const result = deepClone(agent);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const action = await p.select({
      message: 'Agent Settings',
      options: [
        { value: 'general', label: 'General (workspace, iterations, history)' },
        { value: 'security', label: `Security (${formatBoolean(result.security.enabled)})` },
        { value: 'memory', label: `Memory (${formatBoolean(result.memory.auto_retrieval)})` },
        { value: 'proactive', label: `Proactive (${formatBoolean(result.proactive.enabled)})` },
        { value: 'back', label: 'Back' },
      ],
    });
    handleCancel(action);
    if (action === 'back') break;

    if (action === 'general') {
      const workspace = await p.text({
        message: 'Workspace path',
        defaultValue: result.workspace,
      });
      handleCancel(workspace);
      result.workspace = workspace as string;

      const maxIter = await p.text({
        message: 'Max iterations',
        defaultValue: String(result.max_iterations),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive integer';
        },
      });
      handleCancel(maxIter);
      result.max_iterations = parseInt(maxIter as string, 10);

      const maxInput = await p.text({
        message: 'Max input length',
        defaultValue: String(result.max_input_length),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 100) return 'Must be at least 100';
        },
      });
      handleCancel(maxInput);
      result.max_input_length = parseInt(maxInput as string, 10);

      const historyLimit = await p.text({
        message: 'History limit',
        defaultValue: String(result.history_limit),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive integer';
        },
      });
      handleCancel(historyLimit);
      result.history_limit = parseInt(historyLimit as string, 10);
    }

    if (action === 'security') {
      const enabled = await p.confirm({
        message: 'Enable security?',
        initialValue: result.security.enabled,
      });
      handleCancel(enabled);
      result.security.enabled = enabled as boolean;
    }

    if (action === 'memory') {
      const autoRetrieval = await p.confirm({
        message: 'Auto retrieval?',
        initialValue: result.memory.auto_retrieval,
      });
      handleCancel(autoRetrieval);
      result.memory.auto_retrieval = autoRetrieval as boolean;

      const autoExtraction = await p.confirm({
        message: 'Auto extraction?',
        initialValue: result.memory.auto_extraction,
      });
      handleCancel(autoExtraction);
      result.memory.auto_extraction = autoExtraction as boolean;

      const retrievalLimit = await p.text({
        message: 'Retrieval limit',
        defaultValue: String(result.memory.retrieval_limit),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive integer';
        },
      });
      handleCancel(retrievalLimit);
      result.memory.retrieval_limit = parseInt(retrievalLimit as string, 10);
    }

    if (action === 'proactive') {
      const enabled = await p.confirm({
        message: 'Enable proactive follow-ups?',
        initialValue: result.proactive.enabled,
      });
      handleCancel(enabled);
      result.proactive.enabled = enabled as boolean;
    }
  }

  return result;
}

async function editServerSection(server: AppConfig['server']): Promise<AppConfig['server']> {
  const result = deepClone(server);

  const enabled = await p.confirm({
    message: 'Enable HTTP API server?',
    initialValue: result.enabled,
  });
  handleCancel(enabled);
  result.enabled = enabled as boolean;

  const ip = await p.text({
    message: 'Listen IP',
    defaultValue: result.ip || '0.0.0.0',
  });
  handleCancel(ip);
  result.ip = ip as string;

  const port = await p.text({
    message: 'Port',
    defaultValue: String(result.port || 3000),
    validate: (v) => {
      if (!v) return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 65535) return 'Must be a valid port (1-65535)';
    },
  });
  handleCancel(port);
  result.port = parseInt(port as string, 10);

  const apiKey = await p.password({
    message: `API key ${result.apiKey ? pc.dim(`(current: ${maskSecret(result.apiKey)}, enter to keep)`) : pc.dim('(empty = no auth)')}`,
  });
  handleCancel(apiKey);
  if (apiKey) result.apiKey = apiKey as string;

  return result;
}

async function editTelegramSection(telegram: AppConfig['channel']['telegram']): Promise<AppConfig['channel']['telegram']> {
  const result = deepClone(telegram);

  const enabled = await p.confirm({
    message: 'Enable Telegram?',
    initialValue: result.enabled,
  });
  handleCancel(enabled);
  result.enabled = enabled as boolean;

  if (result.enabled) {
    const token = await p.password({
      message: `Bot token ${result.token ? pc.dim(`(current: ${maskSecret(result.token)}, enter to keep)`) : ''}`,
    });
    handleCancel(token);
    if (token) result.token = token as string;

    const users = await p.text({
      message: 'Allowed user IDs (comma-separated, empty = all)',
      defaultValue: result.allowed_users?.join(', ') || '',
    });
    handleCancel(users);
    result.allowed_users = (users as string)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const rateWindow = await p.text({
      message: 'Rate limit window (ms)',
      defaultValue: String(result.rate_limit_window || 60000),
      validate: (v) => {
        if (!v) return;
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1000) return 'Must be at least 1000ms';
      },
    });
    handleCancel(rateWindow);
    result.rate_limit_window = parseInt(rateWindow as string, 10);

    const rateMax = await p.text({
      message: 'Rate limit max messages',
      defaultValue: String(result.rate_limit_max || 10),
      validate: (v) => {
        if (!v) return;
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1) return 'Must be at least 1';
      },
    });
    handleCancel(rateMax);
    result.rate_limit_max = parseInt(rateMax as string, 10);
  }

  return result;
}

async function editWhatsAppSection(whatsapp: AppConfig['channel']['whatsapp']): Promise<AppConfig['channel']['whatsapp']> {
  const result = deepClone(whatsapp);

  const enabled = await p.confirm({
    message: 'Enable WhatsApp?',
    initialValue: result.enabled,
  });
  handleCancel(enabled);
  result.enabled = enabled as boolean;

  if (result.enabled) {
    const numbers = await p.text({
      message: 'Allowed phone numbers (comma-separated, empty = all)',
      defaultValue: result.allowed_numbers?.join(', ') || '',
    });
    handleCancel(numbers);
    result.allowed_numbers = (numbers as string)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return result;
}

async function editWebhookSection(webhook: AppConfig['channel']['webhook']): Promise<AppConfig['channel']['webhook']> {
  const result = deepClone(webhook);

  const enabled = await p.confirm({
    message: 'Enable webhook?',
    initialValue: result.enabled,
  });
  handleCancel(enabled);
  result.enabled = enabled as boolean;

  if (result.enabled) {
    const callbackUrl = await p.text({
      message: 'Callback URL',
      defaultValue: result.callback_url || '',
      placeholder: 'https://your-server.com/webhook',
      validate: (val) => {
        if (!val) return 'Callback URL is required';
        try { new URL(val); } catch { return 'Must be a valid URL'; }
      },
    });
    handleCancel(callbackUrl);
    result.callback_url = callbackUrl as string;

    const secret = await p.password({
      message: `Webhook secret ${result.secret ? pc.dim(`(current: ${maskSecret(result.secret)}, enter to keep)`) : pc.dim('(empty = no HMAC)')}`,
    });
    handleCancel(secret);
    if (secret) result.secret = secret as string;
  }

  return result;
}

async function editChannelsSection(channel: AppConfig['channel']): Promise<AppConfig['channel']> {
  const result = deepClone(channel);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const action = await p.select({
      message: 'Channels',
      options: [
        { value: 'telegram', label: `Telegram (${formatBoolean(result.telegram?.enabled)})` },
        { value: 'whatsapp', label: `WhatsApp (${formatBoolean(result.whatsapp?.enabled)})` },
        { value: 'webhook', label: `Webhook (${formatBoolean(result.webhook?.enabled)})` },
        { value: 'back', label: 'Back' },
      ],
    });
    handleCancel(action);
    if (action === 'back') break;

    if (action === 'telegram') result.telegram = await editTelegramSection(result.telegram);
    if (action === 'whatsapp') result.whatsapp = await editWhatsAppSection(result.whatsapp);
    if (action === 'webhook') result.webhook = await editWebhookSection(result.webhook);
  }

  return result;
}

async function editQueueSection(queue: AppConfig['queue']): Promise<AppConfig['queue']> {
  const result = deepClone(queue);

  const redisUrl = await p.text({
    message: 'Redis URL',
    defaultValue: result.redis_url || 'redis://localhost:6379/0',
  });
  handleCancel(redisUrl);
  result.redis_url = redisUrl as string;

  const keyPrefix = await p.text({
    message: 'Key prefix',
    defaultValue: result.key_prefix || 'botbot:',
  });
  handleCancel(keyPrefix);
  result.key_prefix = keyPrefix as string;

  const agentConc = await p.text({
    message: 'Agent concurrency',
    defaultValue: String(result.agent_concurrency ?? 3),
    validate: (v) => {
      if (!v) return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return 'Must be a positive integer';
    },
  });
  handleCancel(agentConc);
  result.agent_concurrency = parseInt(agentConc as string, 10);

  const toolConc = await p.text({
    message: 'Tool concurrency',
    defaultValue: String(result.tool_concurrency ?? 3),
    validate: (v) => {
      if (!v) return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return 'Must be a positive integer';
    },
  });
  handleCancel(toolConc);
  result.tool_concurrency = parseInt(toolConc as string, 10);

  const taskConc = await p.text({
    message: 'Task concurrency',
    defaultValue: String(result.task_concurrency ?? 3),
    validate: (v) => {
      if (!v) return;
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return 'Must be a positive integer';
    },
  });
  handleCancel(taskConc);
  result.task_concurrency = parseInt(taskConc as string, 10);

  return result;
}

async function editSkillsSection(skills: SkillsConfig): Promise<SkillsConfig> {
  const result = deepClone(skills);
  const skillNames = Object.keys(result);

  if (skillNames.length === 0) {
    p.log.info('No skills configured.');
    return result;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const options = skillNames.map((name) => ({
      value: name,
      label: `${name} (${formatBoolean(result[name]?.enabled)})`,
    }));
    options.push({ value: 'back', label: 'Back' });

    const action = await p.select({ message: 'Skills', options });
    handleCancel(action);
    if (action === 'back') break;

    const name = action as string;
    const skill = result[name];

    const enabled = await p.confirm({
      message: `Enable ${name}?`,
      initialValue: skill.enabled,
    });
    handleCancel(enabled);
    skill.enabled = enabled as boolean;

    // Edit known properties per skill type
    if (name === 'terminal' && skill.enabled) {
      const timeout = await p.text({
        message: 'Terminal timeout (seconds)',
        defaultValue: String(skill.timeout ?? 300),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive integer';
        },
      });
      handleCancel(timeout);
      skill.timeout = parseInt(timeout as string, 10);

      const denied = await p.text({
        message: 'Denied commands (comma-separated)',
        defaultValue: (skill.denied_commands || []).join(', '),
      });
      handleCancel(denied);
      skill.denied_commands = (denied as string)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    if (name === 'browser' && skill.enabled) {
      const mode = await p.select({
        message: 'Browser mode',
        initialValue: skill.mode ?? 'default',
        options: [
          { value: 'default', label: 'default — Playwright bundled Chromium (ephemeral)' },
          { value: 'cdp', label: 'cdp — System Chrome with persistent profile (anti-detection)' },
        ],
      });
      handleCancel(mode);
      skill.mode = mode as string;

      const headless = await p.confirm({
        message: 'Headless mode?',
        initialValue: skill.headless ?? true,
      });
      handleCancel(headless);
      skill.headless = headless as boolean;

      const timeout = await p.text({
        message: 'Browser timeout (seconds)',
        defaultValue: String(skill.timeout ?? 60),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive integer';
        },
      });
      handleCancel(timeout);
      skill.timeout = parseInt(timeout as string, 10);

      if (skill.mode === 'cdp') {
        const cdpPort = await p.text({
          message: 'CDP debug port',
          defaultValue: String(skill.cdp_port ?? 9222),
          validate: (v) => {
            if (!v) return;
            const n = parseInt(v, 10);
            if (isNaN(n) || n < 1 || n > 65535) return 'Must be a valid port (1-65535)';
          },
        });
        handleCancel(cdpPort);
        skill.cdp_port = parseInt(cdpPort as string, 10);

        const windowSize = await p.text({
          message: 'Headless window size (width,height)',
          defaultValue: String(skill.headless_window_size ?? '1920,1080'),
          validate: (v) => {
            if (!v) return;
            if (!/^\d+,\d+$/.test(v)) return 'Format: width,height (e.g., 1920,1080)';
          },
        });
        handleCancel(windowSize);
        skill.headless_window_size = windowSize as string;
      } else {
        delete skill.cdp_port;
        delete skill.headless_window_size;
      }
    }

    if (name === 'search' && skill.enabled) {
      const timeout = await p.text({
        message: 'Search timeout (seconds)',
        defaultValue: String(skill.timeout ?? 60),
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive integer';
        },
      });
      handleCancel(timeout);
      skill.timeout = parseInt(timeout as string, 10);
    }
  }

  return result;
}

// ── Process Detection ───────────────────────────────────────

interface RunningProcesses {
  daemon: boolean;
  workerIds: number[];
}

function detectRunningProcesses(): RunningProcesses {
  const daemonPid = readPidFile(PID_FILE);
  const daemon = daemonPid !== null && isRunning(daemonPid);

  const workerIds = listWorkerIds().filter((id) => {
    const pid = readPidFile(workerPidFile(id));
    return pid !== null && isRunning(pid);
  });

  return { daemon, workerIds };
}

function showRestartHint(processes: RunningProcesses): void {
  if (!processes.daemon && processes.workerIds.length === 0) return;

  const lines: string[] = [
    pc.bold('Running processes detected — restart to apply changes:'),
    '',
  ];

  if (processes.daemon) {
    lines.push(`  ${pc.cyan('botbot restart -d')}`);
  }

  if (processes.workerIds.length > 0) {
    lines.push(`  ${pc.cyan('botbot worker stop all && botbot worker start -d')}`);
  }

  p.note(lines.join('\n'), 'Restart Required');
}

// ── Main ────────────────────────────────────────────────────

export async function runConfigEditor(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' BotBot Config Editor ')));

  // Load config
  if (!fs.existsSync(CONFIG_PATH)) {
    p.log.error(`Config file not found: ${pc.dim(CONFIG_PATH)}`);
    p.log.info(`Run ${pc.cyan('botbot setup')} to create one.`);
    p.outro('');
    return;
  }

  let rawConfig: string;
  try {
    rawConfig = fs.readFileSync(CONFIG_PATH, 'utf-8');
  } catch (err: any) {
    p.log.error(`Failed to read config: ${err.message}`);
    p.outro('');
    return;
  }

  const originalJson = rawConfig;
  const config: AppConfig = JSON.parse(rawConfig);

  displayConfigOverview(config);

  let hasChanges = false;

  // Main loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'llm', label: 'Edit LLM providers' },
        { value: 'agent', label: 'Edit Agent settings' },
        { value: 'server', label: 'Edit Server settings' },
        { value: 'channels', label: 'Edit Channels' },
        { value: 'queue', label: 'Edit Queue settings' },
        { value: 'skills', label: 'Edit Skills' },
        { value: 'view', label: 'View current config' },
        { value: 'save', label: 'Save & exit' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });
    handleCancel(action);

    if (action === 'view') {
      displayConfigOverview(config);
      continue;
    }

    if (action === 'cancel') {
      if (hasChanges) {
        const discard = await p.confirm({
          message: 'Discard unsaved changes?',
          initialValue: false,
        });
        handleCancel(discard);
        if (!discard) continue;
      }
      p.outro('Changes discarded.');
      return;
    }

    if (action === 'save') {
      // Validate with Joi
      const { error } = configValidationSchema.validate(config, { abortEarly: false });
      if (error) {
        p.log.error('Validation errors:');
        for (const detail of error.details) {
          p.log.warn(`  ${detail.path.join('.')}: ${detail.message}`);
        }
        const forceSave = await p.confirm({
          message: 'Save anyway (force)?',
          initialValue: false,
        });
        handleCancel(forceSave);
        if (!forceSave) continue;
      }

      const newJson = JSON.stringify(config, null, 2) + '\n';
      if (newJson === originalJson) {
        p.log.info('No changes to save.');
      } else {
        fs.writeFileSync(CONFIG_PATH, newJson);
        p.log.success(`Config saved to ${pc.dim(CONFIG_PATH)}`);
      }

      const processes = detectRunningProcesses();
      showRestartHint(processes);

      p.outro(pc.green('Done!'));
      return;
    }

    // Section editors
    if (action === 'llm') {
      config.llm = await editLLMSection(config.llm);
      hasChanges = true;
    }
    if (action === 'agent') {
      config.agent = await editAgentSection(config.agent);
      hasChanges = true;
    }
    if (action === 'server') {
      config.server = await editServerSection(config.server);
      hasChanges = true;
    }
    if (action === 'channels') {
      config.channel = await editChannelsSection(config.channel);
      hasChanges = true;
    }
    if (action === 'queue') {
      config.queue = await editQueueSection(config.queue);
      hasChanges = true;
    }
    if (action === 'skills') {
      config.skills = await editSkillsSection(config.skills);
      hasChanges = true;
    }
  }
}
