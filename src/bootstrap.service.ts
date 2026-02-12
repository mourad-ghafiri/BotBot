import { Injectable, OnModuleInit, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { AgentService } from './agent/agent.service';
import { TaskSchedulerService } from './queue/task-scheduler.service';
import { SkillRegistryService } from './skills/skill-registry.service';
import { EventBusService } from './events/event-bus.service';
import { BotEvent } from './events/events';
import { resolveWorkspace, getPersonaPaths } from './cli/paths';

const DEFAULT_BOT_PERSONA = `# BotBot

You are BotBot, a capable personal AI assistant. You help the user with anything they need — answering questions, running tasks, managing information, and automating workflows.

## Personality
- Friendly but not overly chatty. Get things done efficiently.
- Adapt your tone to the user — casual when they are, professional when needed.
- Be proactive: if you notice something useful, suggest it.
- Admit when you don't know something rather than guessing.`;

const DEFAULT_USER_PROFILE = `The user's preferences and details will be learned over time through conversation and stored in memory.`;

@Injectable()
export class BootstrapService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly agent: AgentService,
    private readonly taskScheduler: TaskSchedulerService,
    private readonly skillRegistry: SkillRegistryService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    const workspace = resolveWorkspace(this.config.get('agent.workspace'));

    // Ensure workspace directory
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    // Load persona
    const personaPaths = getPersonaPaths(workspace);

    let botPersona = DEFAULT_BOT_PERSONA;
    if (fs.existsSync(personaPaths.homeBotPersona)) {
      botPersona = fs.readFileSync(personaPaths.homeBotPersona, 'utf-8').trim();
    } else if (fs.existsSync(personaPaths.workspaceBotPersona)) {
      botPersona = fs.readFileSync(personaPaths.workspaceBotPersona, 'utf-8').trim();
    }

    let userProfile = DEFAULT_USER_PROFILE;
    if (fs.existsSync(personaPaths.homeUserProfile)) {
      userProfile = fs.readFileSync(personaPaths.homeUserProfile, 'utf-8').trim();
    } else if (fs.existsSync(personaPaths.workspaceUserProfile)) {
      userProfile = fs.readFileSync(personaPaths.workspaceUserProfile, 'utf-8').trim();
    }

    this.agent.loadPersona(botPersona, userProfile);
    this.logger.log('Persona loaded');

    // Wire scheduler into agent
    this.agent.setScheduler(this.taskScheduler);

    this.logger.log('BotBot initialized');
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.BOTBOT_WORKER_MODE) return;
    this.sendGreeting();
  }

  private sendGreeting(): void {
    const skills = this.skillRegistry.getActiveSkills().map((s) => s.name);
    const channels: string[] = [];
    if (this.config.get('channel.telegram.enabled', false)) channels.push('Telegram');
    if (this.config.get('channel.whatsapp.enabled', false)) channels.push('WhatsApp');
    if (this.config.get('channel.webhook.enabled', false)) channels.push('Webhook');
    if (this.config.get('server.enabled', false)) channels.push('API');

    const lines = [
      `BotBot is online and ready.`,
      ``,
      `<b>Features</b>`,
      `- Persistent memory across conversations`,
      `- Task scheduling (one-off and recurring cron jobs)`,
      `- Reminders and automated execution tasks`,
      `- Proactive messaging (follow-ups, check-ins, task digests)`,
      `- Security guard on input and output`,
    ];

    if (skills.length) {
      lines.push(``, `<b>Skills</b>: ${skills.join(', ')}`);
    }
    if (channels.length) {
      lines.push(``, `<b>Channels</b>: ${channels.join(', ')}`);
    }

    this.logger.log(`Sending greeting to channels: ${channels.join(', ') || 'none'}`);
    this.eventBus.publish(BotEvent.NOTIFICATION_SEND, {
      title: '\u{1F916} BotBot Started',
      body: lines.join('\n'),
      userId: null, // broadcast to all
    });
  }
}
