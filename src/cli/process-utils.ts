import * as fs from 'fs';
import { BOTBOT_HOME } from './paths';

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(pidFile: string): number | null {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Scan ~/.botbot for worker-*.pid files, return sorted IDs. */
export function listWorkerIds(): number[] {
  try {
    return fs.readdirSync(BOTBOT_HOME)
      .filter((f) => /^worker-\d+\.pid$/.test(f))
      .map((f) => parseInt(f.match(/^worker-(\d+)\.pid$/)![1], 10))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}
