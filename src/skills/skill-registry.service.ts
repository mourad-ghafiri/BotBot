import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SkillLoaderService } from './skill-loader.service';
import { SkillExecutorService } from './skill-executor.service';
import { SkillInfo } from './skill.types';
import { EventBusService } from '../events/event-bus.service';
import { BotEvent } from '../events/events';

@Injectable()
export class SkillRegistryService {
  private readonly logger = new Logger(SkillRegistryService.name);
  private skills = new Map<string, SkillInfo>();
  private toolToSkill = new Map<string, string>();
  private builtinDir: string;
  private customDir: string;
  private skillsConfig: Record<string, any>;
  private workspace: string;

  constructor(
    private readonly loader: SkillLoaderService,
    private readonly executor: SkillExecutorService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  initialize(builtinDir: string, customDir: string, skillsConfig: Record<string, any> = {}, workspace?: string) {
    this.builtinDir = builtinDir;
    this.customDir = customDir;
    this.skillsConfig = skillsConfig;
    this.workspace = workspace || '';
  }

  discover(): void {
    const dirs = this.builtinDir === this.customDir
      ? [this.builtinDir]
      : [this.builtinDir, this.customDir];
    for (const directory of dirs) {
      if (!directory || !fs.existsSync(directory)) continue;

      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(directory, entry.name);

        // Require at least tools.json or SKILL.md to be a valid skill
        if (!fs.existsSync(path.join(dirPath, 'tools.json')) && !fs.existsSync(path.join(dirPath, 'SKILL.md'))) continue;

        try {
          const parsed = this.loader.parseSkillDir(dirPath);
          this.skills.set(parsed.name, {
            name: parsed.name,
            description: parsed.description,
            path: dirPath,
            tools: parsed.tools,
            instructions: parsed.instructions,
            metadata: parsed.metadata,
            active: false,
          });
          this.logger.log(`Discovered skill: ${parsed.name} (${parsed.tools.length} tools)`);
        } catch (err) {
          this.logger.warn(`Failed to parse skill at ${entry.name}: ${err}`);
        }
      }
    }
  }

  activate(): void {
    for (const [name, info] of this.skills) {
      const cfg = this.skillsConfig[name];
      if (cfg && typeof cfg === 'object' && cfg.enabled === false) {
        this.logger.log(`Skill ${name} is disabled`);
        continue;
      }

      info.active = true;
      for (const tool of info.tools) {
        const existing = this.toolToSkill.get(tool.name);
        if (existing && existing !== name) {
          this.logger.warn(`Duplicate tool name '${tool.name}': skill '${name}' overrides skill '${existing}'`);
        }
        this.toolToSkill.set(tool.name, name);
      }
      this.logger.log(`Activated skill: ${name}`);
    }
  }

  registerDynamic(name: string): void {
    const dirPath = path.join(this.customDir, name);
    if (!fs.existsSync(path.join(dirPath, 'tools.json')) && !fs.existsSync(path.join(dirPath, 'SKILL.md'))) {
      throw new Error(`No tools.json or SKILL.md found for skill '${name}'`);
    }
    const parsed = this.loader.parseSkillDir(dirPath);
    const info: SkillInfo = {
      name,
      description: parsed.description,
      path: dirPath,
      tools: parsed.tools,
      instructions: parsed.instructions,
      metadata: parsed.metadata,
      active: true,
    };
    this.skills.set(name, info);
    for (const tool of info.tools) {
      this.toolToSkill.set(tool.name, name);
    }
    this.logger.log(`Dynamically registered skill: ${name}`);

    // Notify other processes (workers) about the new skill
    this.eventBus?.publish(BotEvent.SKILL_REGISTERED, { name }).catch(() => {});
  }

  reload(name: string): void {
    const info = this.skills.get(name);
    if (!info) throw new Error(`Skill '${name}' not found`);

    for (const tool of info.tools) {
      this.toolToSkill.delete(tool.name);
    }

    const parsed = this.loader.parseSkillDir(info.path);
    info.tools = parsed.tools;
    info.instructions = parsed.instructions;
    info.description = parsed.description;
    info.metadata = parsed.metadata;
    for (const tool of info.tools) {
      this.toolToSkill.set(tool.name, name);
    }
    this.logger.log(`Reloaded skill: ${name}`);
  }

  reloadAll(): void {
    // Re-discover to pick up newly created skills
    this.discover();
    this.activate();

    // Reload existing skills to refresh their tools/instructions
    for (const name of this.skills.keys()) {
      try {
        this.reload(name);
      } catch (err) {
        this.logger.warn(`Failed to reload skill ${name}: ${err}`);
      }
    }
    this.logger.log('Reloaded all skills');
  }

  unregister(name: string): void {
    const info = this.skills.get(name);
    if (info) {
      for (const tool of info.tools) {
        this.toolToSkill.delete(tool.name);
      }
      this.skills.delete(name);
    }
  }

  getSkillNameForTool(toolName: string): string | null {
    return this.toolToSkill.get(toolName) ?? null;
  }

  getSkill(name: string): SkillInfo | undefined {
    const info = this.skills.get(name);
    return info?.active ? info : undefined;
  }

  getActiveSkills(): SkillInfo[] {
    return Array.from(this.skills.values()).filter((s) => s.active);
  }

  isBuiltin(name: string): boolean {
    const info = this.skills.get(name);
    if (!info) return false;
    return info.path.startsWith(this.builtinDir);
  }

  getSkillConfig(name: string): Record<string, any> {
    const cfg = this.skillsConfig[name];
    const base = cfg && typeof cfg === 'object' ? { ...cfg } : {};
    if (this.workspace) base.workspace = this.workspace;
    return base;
  }

  get customDirPath(): string {
    return this.customDir;
  }

  getExecutorInstance(name: string): any | undefined {
    return this.executor.getInstance(name);
  }

  async execute(toolName: string, args: Record<string, any>): Promise<string> {
    const skillName = this.toolToSkill.get(toolName);
    if (!skillName) throw new Error(`No skill found for tool '${toolName}'`);

    const info = this.skills.get(skillName);
    if (!info?.active) throw new Error(`Skill '${skillName}' is not active`);

    const config = this.getSkillConfig(skillName);
    return this.executor.execute(skillName, toolName, args, info, config);
  }
}
