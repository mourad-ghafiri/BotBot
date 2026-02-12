import { Injectable, Logger } from '@nestjs/common';
import { SkillInfo } from './skill.types';
import { executeSubprocess } from './skill-exec.utils';

@Injectable()
export class SkillExecutorService {
  private readonly logger = new Logger(SkillExecutorService.name);
  private instances = new Map<string, any>();

  registerInstance(skillName: string, instance: any): void {
    this.instances.set(skillName, instance);
  }

  getInstance(skillName: string): any | undefined {
    return this.instances.get(skillName);
  }

  async execute(
    skillName: string,
    toolName: string,
    args: Record<string, any>,
    info: SkillInfo,
    config: Record<string, any> = {},
  ): Promise<string> {
    // In-process execution for registered instances
    if (this.instances.has(skillName)) {
      const instance = this.instances.get(skillName);
      const handler = instance[toolName];
      if (typeof handler === 'function') {
        return handler.call(instance, args);
      }
      if (typeof instance._execute === 'function') {
        return instance._execute(toolName, args);
      }
      throw new Error(`Skill '${skillName}' has no handler for tool '${toolName}'`);
    }

    // Subprocess execution for custom skills
    return executeSubprocess(info.path, toolName, args, config);
  }
}
