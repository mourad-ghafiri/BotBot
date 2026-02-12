/**
 * Terminal skill — shell command execution with background job support.
 * Standalone module: exports async functions matching tool names.
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let _config = {};
let _cwd = null;
const _bgJobs = new Map();
let _jobCounter = 0;

function _initConfig(config) {
  _config = config || {};
  _cwd = _config.workspace || process.cwd();
  // Ensure workspace exists
  if (!fs.existsSync(_cwd)) {
    fs.mkdirSync(_cwd, { recursive: true });
  }
}

function _isDenied(command) {
  const denied = _config.denied_commands || [];
  const cmdLower = command.toLowerCase().trim();
  return denied.some((d) => cmdLower.includes(d.toLowerCase()));
}

async function terminal_exec(args) {
  const command = args.command;
  if (!command) return 'Error: command is required.';
  if (_isDenied(command)) return `Error: command is denied by security policy.`;

  const timeout = (args.timeout || _config.timeout || 60) * 1000;

  // Snapshot directory before command to detect new files
  let filesBefore;
  try { filesBefore = new Set(fs.readdirSync(_cwd)); } catch { filesBefore = new Set(); }

  return new Promise((resolve) => {
    exec(command, { cwd: _cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const parts = [];
      if (stdout) parts.push(stdout.slice(0, 50000));
      if (stderr) parts.push(`[stderr]\n${stderr.slice(0, 10000)}`);
      if (err && err.killed) parts.push(`[timeout after ${timeout / 1000}s]`);
      else if (err) parts.push(`[exit code ${err.code}]`);

      // Detect new files created by the command
      try {
        const filesAfter = fs.readdirSync(_cwd);
        const newFiles = filesAfter.filter((f) => !filesBefore.has(f));
        if (newFiles.length) {
          const absolutePaths = newFiles.map((f) => path.join(_cwd, f));
          parts.push(`[NEW_FILES]\n${absolutePaths.join('\n')}\n[/NEW_FILES]`);
        }
      } catch {}

      resolve(parts.join('\n') || '(no output)');
    });
  });
}

async function terminal_background(args) {
  const command = args.command;
  if (!command) return 'Error: command is required.';
  if (_isDenied(command)) return 'Error: command is denied by security policy.';

  const jobId = `bg-${++_jobCounter}`;
  const child = spawn('sh', ['-c', command], {
    cwd: _cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });

  _bgJobs.set(jobId, { child, output: () => output, done: false, exitCode: null });
  child.on('exit', (code) => {
    const job = _bgJobs.get(jobId);
    if (job) { job.done = true; job.exitCode = code; }
  });

  return `Background job started: ${jobId} (pid ${child.pid})`;
}

async function terminal_output(args) {
  const jobId = args.job_id;
  if (!jobId) return 'Error: job_id is required.';
  const job = _bgJobs.get(jobId);
  if (!job) return `Error: job ${jobId} not found.`;

  const out = job.output();
  const status = job.done ? `[done, exit ${job.exitCode}]` : '[running]';
  return `${status}\n${out.slice(-20000) || '(no output yet)'}`;
}

async function terminal_kill(args) {
  const jobId = args.job_id;
  if (!jobId) return 'Error: job_id is required.';
  const job = _bgJobs.get(jobId);
  if (!job) return `Error: job ${jobId} not found.`;

  try {
    process.kill(-job.child.pid, 'SIGTERM');
  } catch {
    try { job.child.kill('SIGTERM'); } catch {}
  }
  _bgJobs.delete(jobId);
  return `Job ${jobId} terminated.`;
}

async function terminal_cwd(args) {
  if (args.path) {
    const target = path.resolve(_cwd, args.path);
    if (!fs.existsSync(target)) return `Error: directory not found: ${target}`;
    _cwd = target;
    return `Working directory changed to: ${_cwd}`;
  }
  return `Current directory: ${_cwd}`;
}

// Export for in-process use
module.exports = { _initConfig, terminal_exec, terminal_background, terminal_output, terminal_kill, terminal_cwd };

// CLI entry point for subprocess use
if (require.main === module) {
  const toolName = process.argv[2];
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

  const handlers = { terminal_exec, terminal_background, terminal_output, terminal_kill, terminal_cwd };
  const handler = handlers[toolName];
  if (!handler) {
    console.error(`Unknown tool: ${toolName}`);
    process.exit(1);
  }

  // Load config from env
  const configJson = process.env.SKILL_CONFIG;
  if (configJson) {
    try { _initConfig(JSON.parse(configJson)); } catch {}
  }

  handler(args).then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
}
