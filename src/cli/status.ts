import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import Redis from 'ioredis';
import { BOTBOT_HOME, CONFIG_PATH, PID_FILE } from './paths';
import { createLLMProvider } from '../llm/llm-provider.factory';
import { AppConfig, LLMConfig } from '../config/config.types';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function checkConfigFile(): Promise<CheckResult> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { name: 'Config file', passed: false, detail: 'not found' };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    JSON.parse(raw);
    return { name: 'Config file', passed: true, detail: CONFIG_PATH };
  } catch {
    return { name: 'Config file', passed: false, detail: 'invalid JSON' };
  }
}

async function checkRedis(config: AppConfig): Promise<CheckResult> {
  const url = config.queue?.redis_url;
  if (!url) {
    return { name: 'Redis', passed: false, detail: 'no redis_url in config' };
  }

  let host = 'localhost';
  let port = 6379;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || 'localhost';
    port = parseInt(parsed.port, 10) || 6379;
  } catch {}

  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
  });

  try {
    await client.connect();
    await client.ping();
    return { name: 'Redis', passed: true, detail: `${host}:${port}` };
  } catch (err: any) {
    return { name: 'Redis', passed: false, detail: err.message || String(err) };
  } finally {
    try { client.disconnect(); } catch {}
  }
}

async function checkLLMs(config: AppConfig): Promise<CheckResult[]> {
  const configs: LLMConfig[] = Array.isArray(config.llm) ? config.llm : [config.llm];
  const isMulti = configs.length > 1;

  const checks = configs.map(async (llm, i): Promise<CheckResult> => {
    const label = isMulti ? `LLM provider [${i + 1}]` : 'LLM provider';

    if (!llm?.provider) {
      return { name: label, passed: false, detail: 'no provider configured' };
    }

    try {
      const provider = createLLMProvider(llm);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out (10s)')), 10000),
      );
      await Promise.race([
        provider.sendMessage([{ role: 'user', content: 'Hi' }]),
        timeout,
      ]);
      return { name: label, passed: true, detail: `${llm.provider} / ${llm.model}` };
    } catch (err: any) {
      return { name: label, passed: false, detail: err.message || String(err) };
    }
  });

  return Promise.all(checks);
}

async function checkTelegram(config: AppConfig): Promise<CheckResult> {
  if (!config.channel?.telegram?.enabled) {
    return { name: 'Telegram', passed: true, detail: 'disabled (skipped)' };
  }

  const token = config.channel.telegram.token;
  if (!token) {
    return { name: 'Telegram', passed: false, detail: 'no token configured' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as any;
    if (data.ok && data.result?.username) {
      return { name: 'Telegram', passed: true, detail: `@${data.result.username}` };
    }
    return { name: 'Telegram', passed: false, detail: data.description || 'API error' };
  } catch (err: any) {
    return { name: 'Telegram', passed: false, detail: err.message || String(err) };
  }
}

function checkBotPersona(): CheckResult {
  const filePath = path.join(BOTBOT_HOME, 'BOTBOT.md');
  if (fs.existsSync(filePath)) {
    return { name: 'BOTBOT.md', passed: true, detail: filePath };
  }
  return { name: 'BOTBOT.md', passed: false, detail: 'not found' };
}

function checkUserProfile(): CheckResult {
  const filePath = path.join(BOTBOT_HOME, 'USER.md');
  if (fs.existsSync(filePath)) {
    return { name: 'USER.md', passed: true, detail: filePath };
  }
  return { name: 'USER.md', passed: false, detail: 'not found' };
}

function checkWorkspace(config: AppConfig): CheckResult {
  const workspace = config.agent?.workspace;
  if (!workspace) {
    return { name: 'Workspace', passed: false, detail: 'not configured' };
  }

  const resolved = path.isAbsolute(workspace)
    ? workspace
    : path.resolve(BOTBOT_HOME, workspace);

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return { name: 'Workspace', passed: true, detail: resolved };
    }
    return { name: 'Workspace', passed: false, detail: `${resolved} is not a directory` };
  } catch {
    return { name: 'Workspace', passed: false, detail: 'not found' };
  }
}

function checkPidFile(pidFile: string, label: string): CheckResult {
  try {
    if (!fs.existsSync(pidFile)) {
      return { name: label, passed: false, detail: 'not running' };
    }
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      return { name: label, passed: false, detail: 'invalid PID file' };
    }
    process.kill(pid, 0);
    return { name: label, passed: true, detail: `PID ${pid}` };
  } catch {
    return { name: label, passed: false, detail: 'not running' };
  }
}

function checkWorkers(): CheckResult {
  try {
    const files = fs.readdirSync(BOTBOT_HOME).filter((f) => /^worker-\d+\.pid$/.test(f));
    let running = 0;
    for (const f of files) {
      const pid = parseInt(fs.readFileSync(path.join(BOTBOT_HOME, f), 'utf-8').trim(), 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 0);
          running++;
        } catch {
          // Stale PID file
        }
      }
    }
    if (running === 0) {
      return { name: 'Workers', passed: true, detail: 'none running' };
    }
    return { name: 'Workers', passed: true, detail: `${running} running` };
  } catch {
    return { name: 'Workers', passed: true, detail: 'none running' };
  }
}

/**
 * Runs critical checks (config, Redis, workspace) and exits with code 1 if any fail.
 * Used as a preflight gate before starting BotBot. Skips LLM check to avoid
 * token cost, latency, and noisy logs on every start.
 */
export async function runPreflightCheck(): Promise<void> {
  const configResult = await checkConfigFile();
  let config: AppConfig | null = null;
  if (configResult.passed) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }

  const results: CheckResult[] = [configResult];

  if (config) {
    results.push(await checkRedis(config));
    results.push(checkWorkspace(config));
  } else {
    results.push(
      { name: 'Redis', passed: false, detail: 'config not loaded' },
      { name: 'Workspace', passed: false, detail: 'config not loaded' },
    );
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.error(pc.red('\n  Preflight check failed:\n'));
    for (const r of failed) {
      console.error(pc.red(`    \u2717 ${r.name}: ${r.detail}`));
    }
    console.error(`\n  Run ${pc.cyan('botbot status')} for full details.`);
    console.error(`  Run ${pc.cyan('botbot setup')} to reconfigure.\n`);
    process.exit(1);
  }
}

export async function runStatusCheck(): Promise<void> {
  console.log(pc.bold('\n  BotBot Health Check\n'));

  // Load config for checks that need it
  const configResult = await checkConfigFile();
  let config: AppConfig | null = null;
  if (configResult.passed) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }

  const results: CheckResult[] = [configResult];

  if (config) {
    // Run async checks in parallel
    const [redisResult, llmResults, telegramResult] = await Promise.all([
      checkRedis(config),
      checkLLMs(config),
      checkTelegram(config),
    ]);
    results.push(redisResult, ...llmResults, telegramResult);
    results.push(checkBotPersona());
    results.push(checkUserProfile());
    results.push(checkWorkspace(config));
  } else {
    // Config failed — skip config-dependent checks
    results.push(
      { name: 'Redis', passed: false, detail: 'config not loaded' },
      { name: 'LLM provider', passed: false, detail: 'config not loaded' },
      { name: 'Telegram', passed: false, detail: 'config not loaded' },
      { name: 'BOTBOT.md', passed: false, detail: 'config not loaded' },
      { name: 'USER.md', passed: false, detail: 'config not loaded' },
      { name: 'Workspace', passed: false, detail: 'config not loaded' },
    );
  }

  results.push(checkPidFile(PID_FILE, 'Daemon'));
  results.push(checkWorkers());

  // Print results
  const maxName = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const tag = r.passed ? pc.green(' PASS ') : pc.red(' FAIL ');
    const name = r.name.padEnd(maxName);
    console.log(`  ${tag}  ${name}  ${pc.dim(r.detail)}`);
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log('');
  if (failed === 0) {
    console.log(pc.green(`  All ${passed} checks passed`));
  } else {
    console.log(pc.yellow(`  ${passed} passed, ${failed} failed`));
  }
  console.log('');
}
