import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { resolveWorkspace, SKILLS_DIR } from '../cli/paths';
import { SkillLoaderService } from './skill-loader.service';
import { SkillRegistryService } from './skill-registry.service';
import { SkillExecutorService } from './skill-executor.service';
import { ToolRouterService } from './tool-router.service';
import { MemoryModule } from '../memory/memory.module';
import { TaskModule } from '../task/task.module';
import { EventBusService } from '../events/event-bus.service';
import { BotEvent, SkillRegisteredPayload } from '../events/events';

@Module({
  imports: [MemoryModule, TaskModule],
  providers: [SkillLoaderService, SkillRegistryService, SkillExecutorService, ToolRouterService],
  exports: [SkillRegistryService, SkillExecutorService, ToolRouterService],
})
export class SkillsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillsModule.name);
  private browserInstance: any = null;

  constructor(
    private readonly config: ConfigService,
    private readonly skillRegistry: SkillRegistryService,
    private readonly skillExecutor: SkillExecutorService,
    private readonly toolRouter: ToolRouterService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    const workspace = resolveWorkspace(this.config.get('agent.workspace'));
    const builtinSrcDir = path.join(__dirname, 'builtin-skills');
    const skillsDir = SKILLS_DIR;
    const skillsConfig = this.config.get('skills', {}) as Record<string, any>;

    // Sync builtin skills to SKILLS_DIR (safety net for updates after git pull)
    this.syncBuiltinSkills(builtinSrcDir, skillsDir);

    this.skillRegistry.initialize(skillsDir, skillsDir, skillsConfig, workspace);
    this.skillRegistry.discover();
    this.skillRegistry.activate();

    await this.wireBuiltinSkills(skillsDir, skillsConfig, workspace);

    // Register skill_creator tools as local (they mutate the main process's registry)
    const sc = this.skillRegistry.getSkill('skill_creator');
    if (sc) {
      for (const t of sc.tools) {
        this.toolRouter.registerLocalSkillTool(t.name);
      }
    }

    // Register browser tools as local (they require the same Playwright instance)
    const browser = this.skillRegistry.getSkill('browser');
    if (browser) {
      for (const t of browser.tools) {
        this.toolRouter.registerLocalSkillTool(t.name);
      }
    }

    // Subscribe to dynamic skill registration from other processes
    this.eventBus.subscribe(BotEvent.SKILL_REGISTERED, (payload: SkillRegisteredPayload) => {
      if (this.skillRegistry.getSkill(payload.name)) return; // Already known
      try {
        this.skillRegistry.registerDynamic(payload.name);
        this.logger.log(`Synced dynamic skill from another process: ${payload.name}`);
      } catch (err) {
        this.logger.warn(`Failed to sync dynamic skill '${payload.name}': ${err}`);
      }
    });

    this.logger.log('Skill system initialized');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserInstance) {
      try {
        await this.browserInstance.shutdown();
        this.logger.log('Browser skill shut down');
      } catch (err) {
        this.logger.warn(`Browser shutdown error: ${err}`);
      }
      this.browserInstance = null;
    }
  }

  private syncBuiltinSkills(srcDir: string, destDir: string): void {
    if (!fs.existsSync(srcDir)) {
      this.logger.warn(`Builtin skills source not found: ${srcDir}`);
      return;
    }

    fs.mkdirSync(destDir, { recursive: true });

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const destSkillDir = path.join(destDir, entry.name);
      if (fs.existsSync(destSkillDir)) continue; // Don't overwrite user customizations

      this.copyDirRecursive(path.join(srcDir, entry.name), destSkillDir);
      this.logger.log(`Copied builtin skill '${entry.name}' to workspace`);
    }
  }

  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  private async wireBuiltinSkills(skillsDir: string, skillsConfig: Record<string, any>, workspace: string): Promise<void> {
    // Terminal
    const terminalScript = path.join(skillsDir, 'terminal', 'scripts', 'terminal.js');
    if (fs.existsSync(terminalScript)) {
      try {
        const terminalModule = require(terminalScript);
        terminalModule._initConfig({ ...(skillsConfig.terminal || {}), workspace });
        this.skillExecutor.registerInstance('terminal', terminalModule);
      } catch (err) {
        this.logger.warn(`Failed to load terminal skill: ${err}`);
      }
    }

    // Browser (with health check + launch/connect)
    const browserScript = path.join(skillsDir, 'browser', 'scripts', 'browser.js');
    if (fs.existsSync(browserScript)) {
      try {
        const { BrowserSkill } = require(browserScript);
        const browserInst = new BrowserSkill({ ...(skillsConfig.browser || {}), workspace });
        if (typeof browserInst._healthCheck === 'function') {
          browserInst._healthCheck();
        }

        const mode = (skillsConfig.browser || {}).mode || 'default';

        if (process.env.BOTBOT_WORKER_MODE) {
          // Worker mode: connect to existing Chrome (CDP) or launch ephemeral (default)
          await browserInst.connect();
          this.logger.log(`Browser skill connected (${mode} worker mode)`);
        } else {
          // Main process: spawn + connect
          await browserInst.launch();
          this.browserInstance = browserInst; // Only main owns the process
          this.logger.log(`Browser skill launched (${mode})`);
        }

        this.skillExecutor.registerInstance('browser', browserInst);
      } catch (err) {
        this.logger.warn(`Skipping browser skill: ${err}`);
      }
    }

    // Search
    const searchScript = path.join(skillsDir, 'search', 'scripts', 'search.js');
    if (fs.existsSync(searchScript)) {
      try {
        const searchModule = require(searchScript);
        this.skillExecutor.registerInstance('search', searchModule);
      } catch (err) {
        this.logger.warn(`Failed to load search skill: ${err}`);
      }
    }

    // Skill Creator
    const skillCreatorScript = path.join(skillsDir, 'skill_creator', 'scripts', 'skill_creator.js');
    if (fs.existsSync(skillCreatorScript)) {
      try {
        const scModule = require(skillCreatorScript);
        scModule._init(this.skillRegistry, skillsDir);
        this.skillExecutor.registerInstance('skill_creator', scModule);
      } catch (err) {
        this.logger.warn(`Failed to load skill_creator skill: ${err}`);
      }
    }
  }
}
