import * as p from '@clack/prompts';
import pc from 'picocolors';
import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { execSync } from 'child_process';
import { BOTBOT_HOME, CONFIG_PATH, DEFAULT_WORKSPACE, LOG_DIR, SKILLS_DIR } from './paths';
import { PROVIDER_DEFAULTS, VALID_PROVIDERS } from '../llm/provider-defaults';
import { createLLMProvider } from '../llm/llm-provider.factory';
import { LLMConfig } from '../config/config.types';

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

interface ProviderInfo {
  emoji: string;
  description: string;
  keyUrl: string;
  pricing: string;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  openai:              { emoji: '\u{1F9E0}', description: 'OpenAI GPT models',           keyUrl: 'https://platform.openai.com/api-keys',              pricing: 'Pay-as-you-go' },
  openrouter:          { emoji: '\u{1F310}', description: 'Multi-provider gateway',      keyUrl: 'https://openrouter.ai/keys',                        pricing: 'Free tier, pay-per-token' },
  ollama:              { emoji: '\u{1F4BB}', description: 'Local models on your machine', keyUrl: 'https://ollama.com',                                 pricing: 'Free, local' },
  anthropic:           { emoji: '\u{1F4DC}', description: 'Claude models by Anthropic',   keyUrl: 'https://console.anthropic.com/settings/keys',        pricing: 'Pay-as-you-go' },
  groq:                { emoji: '\u{26A1}',  description: 'Ultra-fast inference',         keyUrl: 'https://console.groq.com/keys',                     pricing: 'Generous free tier' },
  together:            { emoji: '\u{1F91D}', description: 'Open-source model hosting',   keyUrl: 'https://api.together.ai/settings/api-keys',          pricing: 'Free trial credits' },
  deepseek:            { emoji: '\u{1F50D}', description: 'DeepSeek AI models',           keyUrl: 'https://platform.deepseek.com/api_keys',             pricing: 'Very affordable' },
  gemini:              { emoji: '\u{2728}',  description: 'Google Gemini models',         keyUrl: 'https://aistudio.google.com/apikey',                 pricing: 'Free tier available' },
  azure:               { emoji: '\u{2601}\u{FE0F}',  description: 'Azure OpenAI Service',         keyUrl: 'https://portal.azure.com',                           pricing: 'Enterprise, Azure subscription' },
  'openai-compatible': { emoji: '\u{1F527}', description: 'Custom OpenAI-compatible API', keyUrl: '',                                                   pricing: 'Custom endpoint' },
};

function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }
}

async function testRedisConnection(
  host: string,
  port: number,
  password: string,
  db: number,
): Promise<{ ok: boolean; error?: string }> {
  const client = new Redis({
    host,
    port,
    password: password || undefined,
    db,
    lazyConnect: true,
    connectTimeout: 5000,
  });
  try {
    await client.connect();
    await client.ping();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    try { client.disconnect(); } catch {}
  }
}

async function testLLMConnection(
  config: LLMConfig,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const provider = createLLMProvider(config);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out (10s)')), 10000),
    );
    await Promise.race([
      provider.sendMessage([{ role: 'user', content: 'Hi' }]),
      timeout,
    ]);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

function buildRedisUrl(
  host: string,
  port: number,
  password: string,
  db: number,
): string {
  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  }
  return `redis://${host}:${port}/${db}`;
}

export async function runSetupWizard(): Promise<void> {
  // ── Section 1: Welcome ──────────────────────────────────────────────
  p.intro(pc.bgCyan(pc.black(' \u{1F916} BotBot Setup Wizard ')));

  if (fs.existsSync(CONFIG_PATH)) {
    const overwrite = await p.confirm({
      message: `Config already exists at ${pc.dim(CONFIG_PATH)}. Overwrite?`,
      initialValue: false,
    });
    handleCancel(overwrite);
    if (!overwrite) {
      p.outro('Setup cancelled. Existing config preserved.');
      return;
    }
  }

  const workspace = DEFAULT_WORKSPACE;

  // ── Section 2: Redis ────────────────────────────────────────────────
  p.log.step(pc.bold('\u{1F534} Redis'));

  let redisConnected = false;
  let redisHost = 'localhost';
  let redisPort = 6379;
  let redisPassword = '';
  let redisDb = 0;

  while (!redisConnected) {
    const host = await p.text({
      message: 'Redis host',
      placeholder: redisHost,
      defaultValue: redisHost,
    });
    handleCancel(host);
    redisHost = host as string;

    const port = await p.text({
      message: 'Redis port',
      placeholder: String(redisPort),
      defaultValue: String(redisPort),
      validate: (val) => {
        if (!val) return;
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1 || n > 65535) return 'Must be a valid port (1-65535)';
      },
    });
    handleCancel(port);
    redisPort = parseInt(port as string, 10);

    const db = await p.text({
      message: 'Redis database number',
      placeholder: String(redisDb),
      defaultValue: String(redisDb),
      validate: (val) => {
        if (!val) return;
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 0) return 'Must be a non-negative integer';
      },
    });
    handleCancel(db);
    redisDb = parseInt(db as string, 10);

    const password = await p.password({
      message: 'Redis password (leave empty for none)',
    });
    handleCancel(password);
    redisPassword = (password as string) || '';

    const spinner = p.spinner();
    spinner.start('Testing Redis connection...');
    const result = await testRedisConnection(redisHost, redisPort, redisPassword, redisDb);

    if (result.ok) {
      spinner.stop('Redis connection successful');
      redisConnected = true;
    } else {
      spinner.stop(pc.red(`Redis connection failed: ${result.error}`));
      const retry = await p.confirm({
        message: 'Retry Redis configuration?',
        initialValue: true,
      });
      handleCancel(retry);
      if (!retry) {
        p.log.warn('Proceeding without verified Redis connection');
        break;
      }
    }
  }

  // ── Section 3: LLM Provider ─────────────────────────────────────────
  p.log.step(pc.bold('\u{1F9E9} LLM Provider'));

  const llmConfigs: LLMConfig[] = [];

  async function collectOneLLM(): Promise<LLMConfig | null> {
    let connected = false;
    let provider = '';
    let apiKey = '';
    let model = '';
    let baseUrl = '';

    while (!connected) {
      const selectedProvider = await p.select({
        message: 'Choose your LLM provider',
        options: VALID_PROVIDERS.map((id) => {
          const info = PROVIDER_INFO[id] || { emoji: '\u{2699}\u{FE0F}', description: id, keyUrl: '', pricing: '' };
          return {
            value: id,
            label: `${info.emoji}  ${id}`,
            hint: `${info.description} \u{2014} ${pc.dim(info.pricing)}`,
          };
        }),
        initialValue: 'openrouter',
      });
      handleCancel(selectedProvider);
      provider = selectedProvider as string;

      const providerDefaults = PROVIDER_DEFAULTS[provider];
      const info = PROVIDER_INFO[provider];

      // API key
      apiKey = '';
      if (providerDefaults.requires_api_key) {
        if (info?.keyUrl) {
          p.log.info(`Get your API key at: ${pc.cyan(pc.underline(info.keyUrl))}`);
        }
        const key = await p.password({
          message: `Enter your ${provider} API key`,
          validate: (val) => {
            if (!val) return 'API key is required for this provider';
          },
        });
        handleCancel(key);
        apiKey = key as string;
      }

      // Model
      const selectedModel = await p.text({
        message: 'Model name',
        placeholder: providerDefaults.default_model,
        defaultValue: providerDefaults.default_model,
      });
      handleCancel(selectedModel);
      model = selectedModel as string;

      // Base URL (conditional)
      baseUrl = providerDefaults.base_url || '';
      if (providerDefaults.needs_base_url) {
        const url = await p.text({
          message: 'Base URL for the API',
          placeholder: baseUrl || 'https://your-endpoint.com/v1',
          defaultValue: baseUrl || undefined,
          validate: (val) => {
            if (!val) return 'Base URL is required for this provider';
          },
        });
        handleCancel(url);
        baseUrl = url as string;
      }

      // Test LLM connection
      const spinner = p.spinner();
      spinner.start('Testing LLM connection...');

      const llmConfig: LLMConfig = {
        provider,
        api_key: apiKey || undefined,
        model,
        temperature: 0.7,
        max_tokens: 256,
        ...(baseUrl ? { base_url: baseUrl } : {}),
        photo_enabled: false,
        audio_enabled: false,
        video_enabled: false,
        document_enabled: false,
        tool_enabled: false,
      };

      const result = await testLLMConnection(llmConfig);

      if (result.ok) {
        spinner.stop('LLM connection successful');
        connected = true;
        return llmConfig;
      } else {
        spinner.stop(pc.red(`LLM connection failed: ${result.error}`));
        const retry = await p.confirm({
          message: 'Retry LLM configuration?',
          initialValue: true,
        });
        handleCancel(retry);
        if (!retry) {
          p.log.warn('Proceeding without verified LLM connection');
          return llmConfig;
        }
      }
    }
    return null;
  }

  // Collect first (required) provider
  const firstLLM = await collectOneLLM();
  if (firstLLM) llmConfigs.push(firstLLM);

  // Offer to add more providers for load balancing / failover
  let addMore = true;
  while (addMore) {
    const another = await p.confirm({
      message: 'Add another LLM provider? (for load balancing / failover)',
      initialValue: false,
    });
    handleCancel(another);
    if (!another) {
      addMore = false;
    } else {
      const nextLLM = await collectOneLLM();
      if (nextLLM) llmConfigs.push(nextLLM);
    }
  }

  // ── Section 4: Telegram ─────────────────────────────────────────────
  p.log.step(pc.bold('\u{1F4EC} Telegram'));

  const telegramEnabled = await p.confirm({
    message: 'Enable Telegram bot?',
    initialValue: true,
  });
  handleCancel(telegramEnabled);

  let telegramToken = '';
  let telegramUsers: number[] = [];

  if (telegramEnabled) {
    p.log.info(
      `${pc.bold('How to create a Telegram bot:')}\n` +
      `  1. Open Telegram and search for ${pc.cyan('@BotFather')}\n` +
      `  2. Send ${pc.cyan('/newbot')} and follow the prompts\n` +
      `  3. Copy the bot token (looks like ${pc.dim('123456:ABC-DEF...')})`
    );

    const token = await p.password({
      message: 'Paste your Telegram bot token',
      validate: (val) => {
        if (!val) return 'Bot token is required to enable Telegram';
      },
    });
    handleCancel(token);
    telegramToken = token as string;

    p.log.info(
      `${pc.bold('How to find your Telegram user ID:')}\n` +
      `  Open Telegram and message ${pc.cyan('@userinfobot')} \u{2014} it replies with your ID.\n` +
      `  Add IDs to restrict who can use your bot, or leave empty for all users.`
    );

    const usersStr = await p.text({
      message: 'Allowed user IDs (comma-separated, empty = all)',
      placeholder: '123456789, 987654321',
      defaultValue: '',
    });
    handleCancel(usersStr);

    if (usersStr) {
      telegramUsers = (usersStr as string)
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
    }
  }

  // ── Section 5: WhatsApp ────────────────────────────────────────────
  p.log.step(pc.bold('\u{1F4F1} WhatsApp'));

  const whatsappEnabled = await p.confirm({
    message: 'Enable WhatsApp channel?',
    initialValue: false,
  });
  handleCancel(whatsappEnabled);

  let whatsappAllowedNumbers: string[] = [];

  if (whatsappEnabled) {
    p.log.info(
      `${pc.bold('WhatsApp uses QR code authentication.')}\n` +
      `  On first start, a QR code will be displayed in the terminal.\n` +
      `  Scan it with WhatsApp on your phone to link the bot.`
    );

    const numbersStr = await p.text({
      message: 'Allowed phone numbers (comma-separated, empty = all)',
      placeholder: '+1234567890, +0987654321',
      defaultValue: '',
    });
    handleCancel(numbersStr);

    if (numbersStr) {
      whatsappAllowedNumbers = (numbersStr as string)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  // ── Section 6: Webhook ────────────────────────────────────────────
  p.log.step(pc.bold('\u{1F517} Webhook'));

  const webhookEnabled = await p.confirm({
    message: 'Enable outbound webhook?',
    initialValue: false,
  });
  handleCancel(webhookEnabled);

  let webhookCallbackUrl = '';
  let webhookSecret = '';

  if (webhookEnabled) {
    p.log.info(
      `${pc.bold('Webhook sends bot responses to a URL via HTTP POST.')}\n` +
      `  Payloads are signed with HMAC-SHA256 if a secret is provided.`
    );

    const callbackUrl = await p.text({
      message: 'Callback URL',
      placeholder: 'https://your-server.com/webhook',
      validate: (val) => {
        if (!val) return 'Callback URL is required when webhook is enabled';
        try {
          new URL(val);
        } catch {
          return 'Must be a valid URL';
        }
      },
    });
    handleCancel(callbackUrl);
    webhookCallbackUrl = callbackUrl as string;

    const secret = await p.password({
      message: 'Webhook secret for HMAC signing (leave empty for none)',
    });
    handleCancel(secret);
    webhookSecret = (secret as string) || '';
  }

  // ── Section 7: HTTP API Server ──────────────────────────────────────
  p.log.step(pc.bold('\u{1F310} HTTP API Server'));

  const serverEnabled = await p.confirm({
    message: 'Enable HTTP API server?',
    initialValue: false,
  });
  handleCancel(serverEnabled);

  // ── Section 8: Skills ──────────────────────────────────────────────
  p.log.step(pc.bold('\u{1F6E0}\u{FE0F} Skills'));

  // Terminal
  const terminalEnabled = await p.confirm({
    message: 'Enable terminal skill? (shell command execution)',
    initialValue: true,
  });
  handleCancel(terminalEnabled);

  let terminalTimeout = 300;
  if (terminalEnabled) {
    const timeout = await p.text({
      message: 'Terminal command timeout (seconds)',
      placeholder: '300',
      defaultValue: '300',
      validate: (v) => {
        if (!v) return;
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1) return 'Must be a positive integer';
      },
    });
    handleCancel(timeout);
    terminalTimeout = parseInt(timeout as string, 10);
  }

  // Browser
  const browserEnabled = await p.confirm({
    message: 'Enable browser skill? (web automation with Playwright)',
    initialValue: true,
  });
  handleCancel(browserEnabled);

  let browserMode = 'default';
  let browserHeadless = true;
  let browserTimeout = 60;
  let browserCdpPort = 9222;
  if (browserEnabled) {
    const mode = await p.select({
      message: 'Browser mode',
      initialValue: 'default',
      options: [
        { value: 'default', label: 'default', hint: 'Playwright bundled Chromium, fresh profile each time' },
        { value: 'cdp', label: 'cdp', hint: 'System Chrome via DevTools Protocol, persistent profile' },
      ],
    });
    handleCancel(mode);
    browserMode = mode as string;

    const headless = await p.confirm({
      message: 'Headless mode?',
      initialValue: true,
    });
    handleCancel(headless);
    browserHeadless = headless as boolean;

    const timeout = await p.text({
      message: 'Browser timeout (seconds)',
      placeholder: '60',
      defaultValue: '60',
      validate: (v) => {
        if (!v) return;
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1) return 'Must be a positive integer';
      },
    });
    handleCancel(timeout);
    browserTimeout = parseInt(timeout as string, 10);

    if (browserMode === 'cdp') {
      const cdpPort = await p.text({
        message: 'CDP debug port',
        placeholder: '9222',
        defaultValue: '9222',
        validate: (v) => {
          if (!v) return;
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1 || n > 65535) return 'Must be a valid port (1-65535)';
        },
      });
      handleCancel(cdpPort);
      browserCdpPort = parseInt(cdpPort as string, 10);
    }
  }

  // Search
  const searchEnabled = await p.confirm({
    message: 'Enable search skill? (web search via DuckDuckGo)',
    initialValue: true,
  });
  handleCancel(searchEnabled);

  // Skill Creator
  const skillCreatorEnabled = await p.confirm({
    message: 'Enable skill creator? (create custom skills at runtime)',
    initialValue: true,
  });
  handleCancel(skillCreatorEnabled);

  // ── Section 9: Bot & User Profile ───────────────────────────────────
  p.log.step(pc.bold('\u{1F464} Bot & User Profile'));

  const setupProfile = await p.confirm({
    message: 'Set up bot personality and user profile now?',
    initialValue: true,
  });
  handleCancel(setupProfile);

  if (setupProfile) {
    const botName = await p.text({
      message: 'Bot name',
      placeholder: 'BotBot',
      defaultValue: 'BotBot',
    });
    handleCancel(botName);

    const botPersonality = await p.text({
      message: 'Bot personality description',
      placeholder: 'Friendly, efficient, and proactive personal AI assistant',
      defaultValue: 'Friendly, efficient, and proactive personal AI assistant',
    });
    handleCancel(botPersonality);

    const userName = await p.text({
      message: 'Your name',
      placeholder: 'User',
      defaultValue: 'User',
    });
    handleCancel(userName);

    const userDescription = await p.text({
      message: 'Short description about yourself (helps the bot understand you)',
      placeholder: 'A software engineer who likes concise answers',
      defaultValue: '',
    });
    handleCancel(userDescription);

    // Write BOTBOT.md
    const botMd =
      `# ${botName as string}\n\n` +
      `You are ${botName as string}, a capable personal AI assistant. You help the user with anything they need — answering questions, running tasks, managing information, and automating workflows.\n\n` +
      `## Personality\n` +
      `- ${botPersonality as string}\n` +
      `- Adapt your tone to the user — casual when they are, professional when needed.\n` +
      `- Be proactive: if you notice something useful, suggest it.\n` +
      `- Admit when you don't know something rather than guessing.\n`;

    fs.mkdirSync(BOTBOT_HOME, { recursive: true });
    fs.writeFileSync(path.join(BOTBOT_HOME, 'BOTBOT.md'), botMd);

    // Write USER.md
    const userMd =
      `# ${userName as string}\n\n` +
      (userDescription
        ? `${userDescription as string}\n\n`
        : '') +
      `The user's preferences and details will be learned over time through conversation and stored in memory.\n`;

    fs.writeFileSync(path.join(BOTBOT_HOME, 'USER.md'), userMd);

    p.log.success('Persona files written to ~/.botbot/');
  } else {
    p.log.info(
      `You can create these files later:\n` +
      `  ${pc.dim(path.join(BOTBOT_HOME, 'BOTBOT.md'))}  — Bot persona\n` +
      `  ${pc.dim(path.join(BOTBOT_HOME, 'USER.md'))}    — User profile`
    );
  }

  // ── Section 9: Summary & Save ───────────────────────────────────────
  p.log.step(pc.bold('\u{1F4BE} Summary'));

  const redisUrl = buildRedisUrl(redisHost, redisPort, redisPassword, redisDb);

  // Build final LLM configs with production defaults
  const finalLLMConfigs = llmConfigs.map((c) => ({
    ...c,
    max_tokens: 4096,
    tool_enabled: true,
  }));

  const config: Record<string, unknown> = {
    llm: finalLLMConfigs.length === 1 ? finalLLMConfigs[0] : finalLLMConfigs,
    agent: {
      workspace,
      max_iterations: 50,
      max_input_length: 4096,
      history_limit: 100,
      security: { enabled: true },
      memory: {
        auto_retrieval: true,
        auto_extraction: true,
        retrieval_limit: 5,
      },
      proactive: {
        enabled: true,
      },
    },
    server: {
      enabled: serverEnabled as boolean,
      ip: '0.0.0.0',
      port: 3000,
      apiKey: '',
    },
    channel: {
      webhook: {
        enabled: webhookEnabled as boolean,
        callback_url: webhookCallbackUrl,
        secret: webhookSecret,
      },
      telegram: {
        enabled: telegramEnabled as boolean,
        token: telegramToken,
        allowed_users: telegramUsers,
        rate_limit_window: 60000,
        rate_limit_max: 10,
      },
      whatsapp: {
        enabled: whatsappEnabled as boolean,
        allowed_numbers: whatsappAllowedNumbers,
      },
    },
    queue: {
      redis_url: redisUrl,
      key_prefix: 'botbot:',
      agent_concurrency: 3,
      tool_concurrency: 3,
      task_concurrency: 3,
    },
    skills: {
      terminal: {
        enabled: terminalEnabled as boolean,
        timeout: terminalTimeout,
        denied_commands: [
          'rm -rf /',
          'mkfs',
          'dd',
          'shutdown',
          'reboot',
          'halt',
          'poweroff',
          'init',
        ],
      },
      browser: {
        enabled: browserEnabled as boolean,
        headless: browserHeadless,
        timeout: browserTimeout,
        mode: browserMode,
        ...(browserMode === 'cdp' ? { cdp_port: browserCdpPort } : {}),
      },
      search: {
        enabled: searchEnabled as boolean,
        timeout: 60,
      },
      skill_creator: {
        enabled: skillCreatorEnabled as boolean,
      },
    },
  };

  const llmSummaryLines = llmConfigs.map((c, i) => {
    const info = PROVIDER_INFO[c.provider];
    const emoji = info?.emoji || '';
    const label = llmConfigs.length > 1 ? `Provider [${i + 1}]:` : 'Provider:';
    return `  ${pc.bold(label.padEnd(13))} ${emoji} ${c.provider} / ${c.model}`;
  });

  p.log.message(
    `  ${pc.bold('Workspace:')}   ${workspace}\n` +
    `  ${pc.bold('Redis:')}       ${redisHost}:${redisPort}/${redisDb} ${redisConnected ? pc.green('(verified)') : pc.yellow('(unverified)')}\n` +
    llmSummaryLines.join('\n') + '\n' +
    `  ${pc.bold('Telegram:')}    ${telegramEnabled ? pc.green('enabled') : pc.dim('disabled')}\n` +
    `  ${pc.bold('WhatsApp:')}    ${whatsappEnabled ? pc.green('enabled') : pc.dim('disabled')}\n` +
    `  ${pc.bold('Webhook:')}     ${webhookEnabled ? pc.green('enabled') : pc.dim('disabled')}\n` +
    `  ${pc.bold('API Server:')}  ${serverEnabled ? pc.green('enabled') : pc.dim('disabled')}\n` +
    `  ${pc.bold('Skills:')}      ` +
      [
        terminalEnabled ? 'terminal' : null,
        browserEnabled ? `browser (${browserMode})` : null,
        searchEnabled ? 'search' : null,
        skillCreatorEnabled ? 'skill_creator' : null,
      ].filter(Boolean).join(', ') + '\n' +
    `  ${pc.bold('Persona:')}     ${setupProfile ? pc.green('configured') : pc.dim('skipped')}`
  );

  // Create directories
  const dirs = [workspace, SKILLS_DIR, LOG_DIR];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write config
  fs.mkdirSync(BOTBOT_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

  p.log.success(`Config saved to ${pc.dim(CONFIG_PATH)}`);

  // Copy builtin skills to SKILLS_DIR
  const builtinSrcDir = path.join(__dirname, '..', 'skills', 'builtin-skills');
  if (fs.existsSync(builtinSrcDir)) {
    const entries = fs.readdirSync(builtinSrcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const destSkillDir = path.join(SKILLS_DIR, entry.name);
      if (fs.existsSync(destSkillDir)) continue;
      copyDirRecursive(path.join(builtinSrcDir, entry.name), destSkillDir);
    }
    p.log.success('Builtin skills copied to ~/.botbot/skills/');
  }

  // Write skills package.json
  const skillsPkg = {
    name: 'botbot-skills',
    private: true,
    dependencies: {
      'cheerio': '^1.2.0',
      'duck-duck-scrape': '^2.2.7',
      'playwright': '^1.52.0',
    },
  };
  fs.writeFileSync(
    path.join(SKILLS_DIR, 'package.json'),
    JSON.stringify(skillsPkg, null, 2) + '\n',
  );

  // Install skill dependencies
  const depSpinner = p.spinner();
  depSpinner.start('Installing skill dependencies...');
  try {
    execSync('bun install', { cwd: SKILLS_DIR, stdio: 'ignore' });
    depSpinner.stop('Skill dependencies installed');
  } catch (err: any) {
    depSpinner.stop(pc.red(`Failed to install skill dependencies: ${err.message || err}`));
  }

  p.note(
    `${pc.bold('Start BotBot:')}\n` +
    `  botbot start        Start in foreground\n` +
    `  botbot start -d     Start as daemon\n\n` +
    `${pc.bold('Health check:')}\n` +
    `  botbot status       Check all services\n\n` +
    `${pc.bold('Customize personality:')}\n` +
    `  ~/.botbot/BOTBOT.md     Bot persona\n` +
    `  ~/.botbot/USER.md       User profile`,
    'Next steps'
  );

  p.outro(pc.green('\u{2728} Setup complete! Happy botting!'));
}
