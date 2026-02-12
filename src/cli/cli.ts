#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import pc from 'picocolors';
import { BOTBOT_HOME, PID_FILE, LOG_DIR, LOG_FILE, workerPidFile, workerLogFile } from './paths';
import { readPidFile, isRunning, listWorkerIds } from './process-utils';

/** Find next available worker ID. */
function nextWorkerId(): number {
  const ids = listWorkerIds();
  if (ids.length === 0) return 1;
  // Fill gaps first, then increment
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== i + 1) return i + 1;
  }
  return ids.length + 1;
}

async function preflight(): Promise<void> {
  const { runPreflightCheck } = require('./status');
  await runPreflightCheck();
}

async function stopProcess(pidFile: string, label: string): Promise<boolean> {
  const pid = readPidFile(pidFile);
  if (!pid || !isRunning(pid)) {
    if (pid) try { fs.unlinkSync(pidFile); } catch {}
    console.log(`\u25CB ${label} is not running`);
    return false;
  }

  console.log(`Stopping ${label} (PID: ${pid})...`);
  process.kill(pid, 'SIGTERM');

  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isRunning(pid)) {
      try { fs.unlinkSync(pidFile); } catch {}
      console.log(`\u2713 ${label} stopped`);
      return true;
    }
  }

  process.kill(pid, 'SIGKILL');
  try { fs.unlinkSync(pidFile); } catch {}
  console.log(`\u2713 ${label} stopped (forced)`);
  return true;
}

function startDaemonProcess(
  pidFile: string,
  logFile: string,
  label: string,
  env: Record<string, string>,
): void {
  const pid = readPidFile(pidFile);
  if (pid && isRunning(pid)) {
    console.log(`\u25CF ${label} is already running (PID: ${pid})`);
    process.exit(1);
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(logFile, 'a');

  console.log(`Starting ${label} in background...`);
  const child = spawn('node', [path.join(__dirname, '..', 'main.js')], {
    detached: true,
    stdio: ['ignore', out, out],
    cwd: BOTBOT_HOME,
    env,
  });

  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  fs.closeSync(out);

  console.log(`\u2713 ${label} started (PID: ${child.pid})`);
  console.log(`  Logs: ${logFile}`);
  process.exit(0);
}

async function startForeground(env?: Record<string, string>): Promise<void> {
  if (env) Object.assign(process.env, env);
  const { bootstrap } = require('../main');
  await bootstrap();
}

function readLastLines(filePath: string, n: number): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(-n).filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

function followFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.error(`Log file not found: ${filePath}`);
    process.exit(1);
  }

  const tail = spawn('tail', ['-f', filePath], { stdio: 'inherit' });
  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
}

function showLogs(logFile: string, opts: { follow?: boolean; lines?: string }): void {
  const n = parseInt(opts.lines || '50', 10);
  if (opts.follow) {
    const lines = readLastLines(logFile, n);
    for (const line of lines) console.log(line);
    followFile(logFile);
  } else {
    const lines = readLastLines(logFile, n);
    if (lines.length === 0) {
      console.log('No logs found.');
    } else {
      for (const line of lines) console.log(line);
    }
  }
}

function formatUptime(pidFile: string): string {
  try {
    const stat = fs.statSync(pidFile);
    const ms = Date.now() - stat.mtimeMs;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  } catch {
    return '-';
  }
}

// ── Program ─────────────────────────────────────────────────

const program = new Command();

program
  .name('botbot')
  .description('BotBot CLI')
  .version('0.0.1');

program
  .command('setup')
  .description('Interactive setup wizard \u2014 creates ~/.botbot/config.json')
  .action(async () => {
    const { runSetupWizard } = require('./setup-wizard');
    await runSetupWizard();
  });

program
  .command('config')
  .description('Edit ~/.botbot/config.json interactively')
  .action(async () => {
    const { runConfigEditor } = require('./config-editor');
    await runConfigEditor();
  });

program
  .command('start')
  .description('Start BotBot')
  .option('-d, --daemon', 'Run in background')
  .action(async (opts) => {
    await preflight();
    if (opts.daemon) {
      startDaemonProcess(PID_FILE, LOG_FILE, 'BotBot', { ...process.env } as Record<string, string>);
    } else {
      console.log('Starting BotBot...');
      await startForeground();
    }
  });

program
  .command('stop')
  .description('Stop BotBot daemon')
  .action(async () => {
    await stopProcess(PID_FILE, 'BotBot');
  });

program
  .command('status')
  .description('Comprehensive health check of BotBot configuration and services')
  .action(async () => {
    const { runStatusCheck } = require('./status');
    await runStatusCheck();
  });

program
  .command('restart')
  .description('Restart BotBot')
  .option('-d, --daemon', 'Run in background')
  .action(async (opts) => {
    await stopProcess(PID_FILE, 'BotBot');
    await new Promise((r) => setTimeout(r, 1000));
    await preflight();
    if (opts.daemon) {
      startDaemonProcess(PID_FILE, LOG_FILE, 'BotBot', { ...process.env } as Record<string, string>);
    } else {
      console.log('Starting BotBot...');
      await startForeground();
    }
  });

program
  .command('logs')
  .description('View application logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action((opts) => showLogs(LOG_FILE, opts));

// ── Worker Commands ──────────────────────────────────────────

const worker = program
  .command('worker')
  .description('Manage worker processes (tool jobs only)');

worker
  .command('start')
  .description('Start a worker process')
  .option('-c, --concurrency <number>', 'Concurrent tool jobs', '3')
  .option('-d, --daemon', 'Run in background')
  .action(async (opts) => {
    await preflight();
    const workerEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      BOTBOT_WORKER_MODE: '1',
      BOTBOT_CONCURRENCY: opts.concurrency,
    };

    if (opts.daemon) {
      const id = nextWorkerId();
      startDaemonProcess(workerPidFile(id), workerLogFile(id), `Worker ${id}`, workerEnv);
    } else {
      console.log(`Starting worker (concurrency=${opts.concurrency})...`);
      await startForeground(workerEnv);
    }
  });

worker
  .command('stop')
  .description('Stop worker daemon(s)')
  .argument('<id>', 'Worker ID to stop (or "all")')
  .action(async (id) => {
    if (id === 'all') {
      const ids = listWorkerIds();
      if (ids.length === 0) {
        console.log('No workers running.');
        return;
      }
      for (const wid of ids) {
        await stopProcess(workerPidFile(wid), `Worker ${wid}`);
      }
      return;
    }

    const wid = parseInt(id, 10);
    if (isNaN(wid)) {
      console.error('Usage: botbot worker stop <id> or botbot worker stop all');
      process.exit(1);
    }
    await stopProcess(workerPidFile(wid), `Worker ${wid}`);
  });

worker
  .command('restart')
  .description('Restart a worker daemon')
  .argument('<id>', 'Worker ID to restart')
  .option('-c, --concurrency <number>', 'Concurrent tool jobs', '3')
  .action(async (id, opts) => {
    const wid = parseInt(id, 10);
    if (isNaN(wid)) {
      console.error('Worker ID must be a number.');
      process.exit(1);
    }
    await stopProcess(workerPidFile(wid), `Worker ${wid}`);
    await new Promise((r) => setTimeout(r, 1000));
    await preflight();
    const workerEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      BOTBOT_WORKER_MODE: '1',
      BOTBOT_CONCURRENCY: opts.concurrency,
    };
    startDaemonProcess(workerPidFile(wid), workerLogFile(wid), `Worker ${wid}`, workerEnv);
  });

worker
  .command('list')
  .description('List all workers')
  .action(() => {
    const ids = listWorkerIds();
    if (ids.length === 0) {
      console.log('No workers registered.');
      return;
    }

    console.log('');
    console.log(
      pc.bold('  ID'.padEnd(8)) +
      pc.bold('PID'.padEnd(10)) +
      pc.bold('Status'.padEnd(12)) +
      pc.bold('Uptime'),
    );
    console.log('  ' + '-'.repeat(36));

    for (const id of ids) {
      const pidFile = workerPidFile(id);
      const pid = readPidFile(pidFile);
      const running = pid ? isRunning(pid) : false;
      const status = running ? pc.green('running') : pc.red('dead');
      const uptime = running ? formatUptime(pidFile) : '-';

      // Clean stale PID file
      if (!running && pid) {
        try { fs.unlinkSync(pidFile); } catch {}
      }

      if (running) {
        console.log(
          `  ${String(id).padEnd(6)}` +
          `${String(pid).padEnd(10)}` +
          `${status.padEnd(20)}` +
          `${uptime}`,
        );
      }
    }
    console.log('');
  });

worker
  .command('logs')
  .description('View worker logs')
  .argument('<id>', 'Worker ID')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action((id, opts) => {
    const wid = parseInt(id, 10);
    const logPath = workerLogFile(wid);

    if (!fs.existsSync(logPath)) {
      console.error(`No log file found for worker ${wid} (${logPath})`);
      process.exit(1);
    }

    showLogs(logPath, opts);
  });

program.parse();
