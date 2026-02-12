import * as path from 'path';
import * as os from 'os';

export const BOTBOT_HOME = path.join(os.homedir(), '.botbot');
export const CONFIG_PATH = path.join(BOTBOT_HOME, 'config.json');
export const DB_PATH = path.join(BOTBOT_HOME, 'botbot.db');
export const PID_FILE = path.join(BOTBOT_HOME, 'botbot.pid');
export const LOG_DIR = path.join(BOTBOT_HOME, 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'botbot.log');
export const SKILLS_DIR = path.join(BOTBOT_HOME, 'skills');
export const DEFAULT_WORKSPACE = path.join(BOTBOT_HOME, 'workspace');

export function workerPidFile(id: number): string {
  return path.join(BOTBOT_HOME, `worker-${id}.pid`);
}

export function workerLogFile(id: number): string {
  return path.join(LOG_DIR, `worker-${id}.log`);
}

export function resolveWorkspace(workspaceCfg?: string): string {
  if (!workspaceCfg || workspaceCfg === 'workspace') return DEFAULT_WORKSPACE;
  if (path.isAbsolute(workspaceCfg)) return workspaceCfg;
  return path.resolve(BOTBOT_HOME, workspaceCfg);
}

export function getPersonaPaths(workspace: string): {
  homeBotPersona: string;
  homeUserProfile: string;
  workspaceBotPersona: string;
  workspaceUserProfile: string;
} {
  return {
    homeBotPersona: path.join(BOTBOT_HOME, 'BOTBOT.md'),
    homeUserProfile: path.join(BOTBOT_HOME, 'USER.md'),
    workspaceBotPersona: path.join(workspace, 'BOTBOT.md'),
    workspaceUserProfile: path.join(workspace, 'USER.md'),
  };
}
