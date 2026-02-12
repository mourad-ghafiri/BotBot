export const TOOL_JOBS_QUEUE = 'botbot-tool-jobs';

export enum ToolJobPriority {
  INTERACTIVE = 1,
  PROACTIVE = 5,
  TASK_EXECUTION = 10,
}

export interface ToolJobData {
  skillName: string;
  toolName: string;
  args: Record<string, any>;
  skillConfig: Record<string, any>;
  correlationId: string;
  priority: number;
}

export interface ToolJobResult {
  content: string;
  isError: boolean;
}
