import { ContentBlock } from '../llm/llm.types';

export const AGENT_JOBS_QUEUE = 'botbot-agent-jobs';

export enum AgentJobPriority {
  INTERACTIVE = 1,
  PROACTIVE = 5,
  TASK_EXECUTION = 10,
}

export interface AgentJobData {
  userMessage: string | ContentBlock[];
  userId?: string;
  channel?: string;
  priority: number;
  skipSecurity?: boolean;
  disableTaskTools?: boolean;
  activateAllSkills?: boolean;
}

export interface AgentJobResult {
  text: string;
  files: string[];
}
