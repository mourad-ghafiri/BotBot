import { ToolDefinition } from '../llm/llm.types';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  tools: ToolDefinition[];
  instructions: string;
  metadata: Record<string, any>;
  active: boolean;
}
