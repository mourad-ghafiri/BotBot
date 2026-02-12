import { Injectable, Logger } from '@nestjs/common';
import { MemoryService } from '../memory/memory.service';
import { TaskService } from '../task/task.service';
import { SkillRegistryService } from './skill-registry.service';
import { TaskSchedulerRef } from '../task/task-scheduler.interface';
import { SkillInfo } from './skill.types';

type ToolResult = [content: string, isError: boolean];

@Injectable()
export class ToolRouterService {
  private readonly logger = new Logger(ToolRouterService.name);
  private scheduler: TaskSchedulerRef | null = null;
  private readonly localSkillTools = new Set<string>();

  private readonly memoryHandlers: Record<string, (args: Record<string, any>) => Promise<ToolResult>>;
  private readonly taskHandlers: Record<string, (args: Record<string, any>, userId?: string | null) => Promise<ToolResult>>;

  constructor(
    private readonly memoryService: MemoryService,
    private readonly taskService: TaskService,
    private readonly skillRegistry: SkillRegistryService,
  ) {
    this.memoryHandlers = {
      memory_store: (a) => this.memoryStore(a),
      memory_retrieve: (a) => this.memoryRetrieve(a),
      memory_list: (a) => this.memoryList(a),
      memory_delete: (a) => this.memoryDelete(a),
      memory_update: (a) => this.memoryUpdate(a),
    };

    this.taskHandlers = {
      task_create: (a, u) => this.taskCreate(a, u),
      task_list: (a, u) => this.taskList(a, u),
      task_update: (a) => this.taskUpdate(a),
      task_cancel: (a, u) => this.taskCancel(a, u),
    };
  }

  setScheduler(scheduler: TaskSchedulerRef): void {
    this.scheduler = scheduler;
  }

  isLocalTool(name: string): boolean {
    return name in this.memoryHandlers || name in this.taskHandlers || this.localSkillTools.has(name);
  }

  registerLocalSkillTool(name: string): void {
    this.localSkillTools.add(name);
  }

  cleanupBrowserSession(correlationId: string): void {
    try {
      const instance = this.skillRegistry.getExecutorInstance('browser');
      if (instance?.cleanupSession) instance.cleanupSession(correlationId);
    } catch {}
  }

  getSkillForTool(name: string): string | null {
    return this.skillRegistry.getSkillNameForTool(name);
  }

  getSkillConfigForTool(name: string): Record<string, any> {
    const skillName = this.skillRegistry.getSkillNameForTool(name);
    return skillName ? this.skillRegistry.getSkillConfig(skillName) : {};
  }

  async executeTool(name: string, args: Record<string, any>, userId?: string | null): Promise<ToolResult> {
    const memoryHandler = this.memoryHandlers[name];
    if (memoryHandler) {
      try {
        return await memoryHandler(args);
      } catch (err) {
        return [`Memory error: ${err}`, true];
      }
    }

    const taskHandler = this.taskHandlers[name];
    if (taskHandler) {
      try {
        return await taskHandler(args, userId);
      } catch (err) {
        return [`Task error: ${err}`, true];
      }
    }

    // Skill tools
    try {
      const result = await this.skillRegistry.execute(name, args);
      return [result, false];
    } catch (err) {
      this.logger.error(`Skill tool '${name}' failed: ${err}`);
      return [`Error: ${err}`, true];
    }
  }

  handleSkillActivation(args: Record<string, any>, activatedSkills: Set<string>): ToolResult {
    const skillName = (args.skill_name || '').trim();
    if (!skillName) return ['Error: skill_name is required.', true];

    if (activatedSkills.has(skillName)) {
      return [this.formatAlreadyActive(skillName), false];
    }

    const skill = this.skillRegistry.getSkill(skillName);
    if (!skill) {
      const available = this.skillRegistry.getActiveSkills().map((s) => s.name);
      return [`Error: skill '${skillName}' not found. Available: ${available.join(', ')}`, true];
    }

    activatedSkills.add(skillName);
    return [this.formatActivated(skill), false];
  }

  // -- Memory handlers --------------------------------------------------------

  private async memoryStore(args: Record<string, any>): Promise<ToolResult> {
    if (!args.content) return ['Error: content is required.', true];
    let tags = args.tags;
    if (typeof tags === 'string') {
      try { tags = JSON.parse(tags); } catch { tags = tags.split(',').map((t: string) => t.trim()).filter(Boolean); }
    }
    if (!Array.isArray(tags)) tags = [];
    const id = await this.memoryService.store(args.content, args.category || 'general', tags);
    return [`Memory stored (id: ${id}).`, false];
  }

  private async memoryRetrieve(args: Record<string, any>): Promise<ToolResult> {
    if (!args.query) return ['Error: query is required.', true];
    const results = await this.memoryService.retrieve(args.query, args.limit || 5);
    if (!results.length) return ['No matching memories found.', false];
    return [results.map((m) => this.formatMemory(m)).join('\n'), false];
  }

  private async memoryList(args: Record<string, any>): Promise<ToolResult> {
    const results = await this.memoryService.listAll(args.category, args.limit || 50);
    if (!results.length) return ['No memories stored.', false];
    return [results.map((m) => this.formatMemory(m)).join('\n'), false];
  }

  private async memoryDelete(args: Record<string, any>): Promise<ToolResult> {
    if (!args.memory_id) return ['Error: memory_id is required.', true];
    const deleted = await this.memoryService.delete(args.memory_id);
    return [deleted ? 'Memory deleted.' : 'Memory not found.', false];
  }

  private async memoryUpdate(args: Record<string, any>): Promise<ToolResult> {
    if (!args.memory_id) return ['Error: memory_id is required.', true];
    const { memory_id, ...updates } = args;
    const result = await this.memoryService.update(memory_id, updates);
    return [result ? 'Memory updated.' : 'Memory not found.', false];
  }

  // -- Task handlers ----------------------------------------------------------

  private async taskCreate(args: Record<string, any>, userId?: string | null): Promise<ToolResult> {
    if (!args.title) return ['Error: title is required.', true];
    const taskType = args.task_type || 'reminder';
    const status = args.scheduled_at || args.cron_expression ? 'scheduled' : 'pending';
    const task = await this.taskService.create({
      title: args.title,
      description: args.description,
      taskType,
      userId: userId ?? undefined,
      scheduledAt: args.scheduled_at,
      cronExpression: args.cron_expression,
      status,
    });

    if (this.scheduler) {
      try {
        if (args.scheduled_at) {
          await this.scheduler.scheduleTask(task.id, new Date(args.scheduled_at));
        } else if (args.cron_expression) {
          await this.scheduler.registerCron(task.id, args.cron_expression);
        }
      } catch (err) {
        this.logger.error(`Failed to register task ${task.id} with scheduler: ${err}`);
        await this.taskService.update(task.id, { status: 'failed' });
        return [`Task created but scheduling failed: ${err}. The task has been marked as failed.`, true];
      }
    }

    return [`Task created (id: ${task.id}): ${task.title}`, false];
  }

  private async taskList(args: Record<string, any>, userId?: string | null): Promise<ToolResult> {
    const tasks = await this.taskService.listTasks(args.status, userId ?? undefined);
    if (!tasks.length) return ['No tasks found.', false];
    return [tasks.map((t) => `[${t.id}] [${t.status}] ${t.title}`).join('\n'), false];
  }

  private async taskUpdate(args: Record<string, any>): Promise<ToolResult> {
    if (!args.task_id) return ['Error: task_id is required.', true];
    const { task_id, ...updates } = args;
    const result = await this.taskService.update(task_id, updates);
    return [result ? 'Task updated.' : 'Task not found.', false];
  }

  private async taskCancel(args: Record<string, any>, userId?: string | null): Promise<ToolResult> {
    if (!args.task_id) return ['Error: task_id is required.', true];
    const task = await this.taskService.get(args.task_id);
    if (!task) return ['Task not found.', false];
    if (userId && task.userId && task.userId !== userId) {
      return ['Task not found.', false];
    }
    await this.taskService.update(args.task_id, { status: 'cancelled' });
    if (this.scheduler) {
      await this.scheduler.cancelTask(args.task_id);
    }
    return ['Task cancelled.', false];
  }

  // -- Formatters -------------------------------------------------------------

  private formatMemory(m: { id: string; category: string; content: string; tags?: string[] }): string {
    const tags = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
    return `[${m.id}] (${m.category || 'general'}) ${m.content}${tags}`;
  }

  private formatAlreadyActive(skillName: string): string {
    const skill = this.skillRegistry.getSkill(skillName);
    if (skill) {
      return `Skill '${skillName}' already active. Tools: ${skill.tools.map((t) => t.name).join(', ')}`;
    }
    return `Skill '${skillName}' already active.`;
  }

  private formatActivated(skill: SkillInfo): string {
    const lines = [`Skill '${skill.name}' activated. Tools now available:`, ''];
    for (const t of skill.tools) {
      lines.push(`- ${t.name}: ${t.description}`);
    }
    if (skill.instructions) {
      lines.push('', 'Usage instructions:', skill.instructions);
    }
    return lines.join('\n');
  }
}
