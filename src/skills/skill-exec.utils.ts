import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

export function snapshotFiles(dir: string): Set<string> {
  const files = new Set<string>();
  function walk(d: string) {
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(full);
        } else {
          files.add(full);
        }
      }
    } catch {}
  }
  walk(dir);
  return files;
}

export function diffFiles(before: Set<string>, after: Set<string>): string[] {
  const newFiles: string[] = [];
  for (const f of after) {
    if (!before.has(f)) newFiles.push(f);
  }
  return newFiles;
}

export function executeSubprocess(
  skillPath: string,
  toolName: string,
  args: Record<string, any>,
  config: Record<string, any>,
): Promise<string> {
  const scriptsDir = path.join(skillPath, 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    return Promise.resolve(`Error: no scripts directory in ${skillPath}`);
  }

  const files = fs.readdirSync(scriptsDir);
  const script = files.find((f) => f.endsWith('.js'));
  if (!script) {
    return Promise.resolve(`Error: no script found in ${scriptsDir}`);
  }

  const scriptPath = path.join(scriptsDir, script);
  const argsJson = JSON.stringify(args);
  const snapshotBefore = snapshotFiles(skillPath);

  return new Promise((resolve) => {
    const env = { ...process.env };
    if (Object.keys(config).length > 0) {
      env.SKILL_CONFIG = JSON.stringify(config);
    }

    execFile(
      process.execPath,
      [scriptPath, toolName, argsJson],
      { cwd: skillPath, env, timeout: 60000 },
      (error, stdout, stderr) => {
        let output = error
          ? `Error (exit ${error.code ?? 1}): ${stderr || stdout || error.message}`
          : stdout;

        const newFiles = diffFiles(snapshotBefore, snapshotFiles(skillPath));
        if (newFiles.length > 0) {
          output += `\n[NEW_FILES]\n${newFiles.join('\n')}\n[/NEW_FILES]`;
        }

        resolve(output);
      },
    );
  });
}
