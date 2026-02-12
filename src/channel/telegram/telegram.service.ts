import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { TelegramHandlers } from './telegram.handlers';
import { AgentQueueService } from '../../queue/agent-queue.service';
import { ConversationService } from '../../conversation/conversation.service';
import { SkillRegistryService } from '../../skills/skill-registry.service';
import { MemoryService } from '../../memory/memory.service';
import { TaskService } from '../../task/task.service';
import { markdownToTelegramHtml, splitMessage } from './telegram.formatter';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot | null = null;
  private enabled: boolean;
  private token: string;
  private allowedUsers: number[];

  constructor(
    private readonly config: ConfigService,
    private readonly agentQueue: AgentQueueService,
    private readonly conversationService: ConversationService,
    private readonly skillRegistry: SkillRegistryService,
    private readonly memoryService: MemoryService,
    private readonly taskService: TaskService,
  ) {
    this.enabled = this.config.get('channel.telegram.enabled', false);
    this.token = this.config.get('channel.telegram.token', '');
    this.allowedUsers = this.config.get('channel.telegram.allowed_users', []);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.token || process.env.BOTBOT_WORKER_MODE) {
      this.logger.log('Telegram channel disabled');
      return;
    }

    this.bot = new Bot(this.token);

    const handlers = new TelegramHandlers(
      this.agentQueue,
      this.conversationService,
      this.skillRegistry,
      this.memoryService,
      this.taskService,
      this.config,
      this.allowedUsers,
      {
        window: this.config.get('channel.telegram.rate_limit_window', 60000),
        max: this.config.get('channel.telegram.rate_limit_max', 10),
      },
    );
    handlers.register(this.bot);

    this.bot.start({
      onStart: () => this.logger.log('Telegram bot started'),
      allowed_updates: ['message', 'callback_query'],
      timeout: 10,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.logger.log('Telegram bot stopped');
    }
  }

  async sendMessage(userId: number | string, text: string): Promise<void> {
    if (!this.bot) return;
    const chatId = typeof userId === 'string' ? parseInt(userId) : userId;
    const html = markdownToTelegramHtml(text);
    for (const chunk of splitMessage(html)) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      } catch {
        try { await this.bot.api.sendMessage(chatId, chunk); } catch (err) {
          this.logger.warn(`Failed to send to ${chatId}: ${err}`);
        }
      }
    }
  }

  async sendFile(userId: number | string, filePath: string): Promise<void> {
    if (!this.bot) return;
    const chatId = typeof userId === 'string' ? parseInt(userId) : userId;
    const fs = await import('fs');
    const path = await import('path');
    const { InputFile } = await import('grammy');

    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size > 50 * 1024 * 1024) return;

    const stream = fs.createReadStream(filePath);
    const inputFile = new InputFile(stream, path.basename(filePath));

    try {
      await this.bot.api.sendDocument(chatId, inputFile);
    } catch (err) {
      this.logger.warn(`Failed to send file to ${chatId}: ${err}`);
    }
  }

  async sendFileByType(userId: number | string, filePath: string): Promise<void> {
    if (!this.bot) return;
    const chatId = typeof userId === 'string' ? parseInt(userId) : userId;
    const fs = await import('fs');
    const path = await import('path');
    const { InputFile } = await import('grammy');

    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size > 50 * 1024 * 1024) return;

    const ext = path.extname(filePath).toLowerCase();
    const stream = fs.createReadStream(filePath);
    const inputFile = new InputFile(stream, path.basename(filePath));

    try {
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        await this.bot.api.sendPhoto(chatId, inputFile);
      } else if (['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(ext)) {
        await this.bot.api.sendVideo(chatId, inputFile);
      } else if (['.mp3', '.ogg', '.opus', '.flac', '.wav', '.m4a', '.aac'].includes(ext)) {
        await this.bot.api.sendAudio(chatId, inputFile);
      } else {
        await this.bot.api.sendDocument(chatId, inputFile);
      }
    } catch (err) {
      this.logger.warn(`Failed to send file ${filePath} to ${chatId}: ${err}`);
    }
  }

  get isEnabled(): boolean { return this.enabled && !!this.bot; }
  get allowedUserIds(): number[] { return this.allowedUsers; }
}
