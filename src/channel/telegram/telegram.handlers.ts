import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, Context, InputFile } from 'grammy';
import { AgentQueueService } from '../../queue/agent-queue.service';
import { AgentJobPriority } from '../../queue/agent-job.types';
import { ConversationService } from '../../conversation/conversation.service';
import { SkillRegistryService } from '../../skills/skill-registry.service';
import { MemoryService } from '../../memory/memory.service';
import { TaskService } from '../../task/task.service';
import { ContentBlock } from '../../llm/llm.types';
import { markdownToTelegramHtml, splitMessage } from './telegram.formatter';
import * as fs from 'fs';
import * as path from 'path';

const STATUS_EMOJI: Record<string, string> = {
  scheduled: '\u{1F4C5}',
  running: '\u{26A1}',
  pending: '\u{23F3}',
  completed: '\u{2705}',
  failed: '\u{274C}',
  cancelled: '\u{1F6AB}',
};

const CATEGORY_EMOJI: Record<string, string> = {
  personal: '\u{1F464}',
  preference: '\u{2699}\u{FE0F}',
  project: '\u{1F4C1}',
  decision: '\u{1F4CB}',
  system: '\u{1F5A5}\u{FE0F}',
  general: '\u{1F4AC}',
};

export class TelegramHandlers {
  private readonly logger = new Logger(TelegramHandlers.name);
  private readonly userMessageTimestamps = new Map<string, number[]>();
  private readonly rateLimitWindow: number;
  private readonly rateLimitMax: number;

  constructor(
    private readonly agentQueue: AgentQueueService,
    private readonly conversationService: ConversationService,
    private readonly skillRegistry: SkillRegistryService,
    private readonly memoryService: MemoryService,
    private readonly taskService: TaskService,
    private readonly configService: ConfigService,
    private readonly allowedUsers: number[],
    rateLimitConfig: { window: number; max: number },
  ) {
    this.rateLimitWindow = rateLimitConfig.window;
    this.rateLimitMax = rateLimitConfig.max;
  }

  register(bot: Bot): void {
    // Auth filter
    bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (this.allowedUsers.length && userId && !this.allowedUsers.includes(userId)) {
        return;
      }
      await next();
    });

    bot.command('start', (ctx) => this.handleStart(ctx));
    bot.command('help', (ctx) => this.handleHelp(ctx));
    bot.command('skills', (ctx) => this.handleSkills(ctx));
    bot.command('memory', (ctx) => this.handleMemory(ctx));
    bot.command('tasks', (ctx) => this.handleTasks(ctx));
    bot.command('cancel', (ctx) => this.handleCancel(ctx));
    bot.command('stop', (ctx) => this.handleStop(ctx));
    bot.command('clear', (ctx) => this.handleClear(ctx));
    bot.on('message:photo', (ctx) => this.handleMessage(ctx));
    bot.on('message:audio', (ctx) => this.handleMessage(ctx));
    bot.on('message:voice', (ctx) => this.handleMessage(ctx));
    bot.on('message:video', (ctx) => this.handleMessage(ctx));
    bot.on('message:document', (ctx) => this.handleMessage(ctx));
    bot.on('message:text', (ctx) => this.handleMessage(ctx));
  }

  // -- Command handlers -------------------------------------------------------

  private async handleStart(ctx: Context): Promise<void> {
    await ctx.reply('Hey! I\'m BotBot, your personal assistant. Send me a message to get started.');
  }

  private async handleHelp(ctx: Context): Promise<void> {
    const help = [
      '<b>BotBot Commands</b>',
      '',
      '/start \u{2014} Start the bot',
      '/help \u{2014} Show this help',
      '/skills \u{2014} List available skills',
      '/memory \u{2014} Browse stored memories',
      '/tasks \u{2014} View your tasks',
      '/cancel \u{2014} Abort current agent loop',
      '/stop \u{2014} Stop current tool execution',
      '/clear \u{2014} Clear conversation context',
      '',
      'Just send a message to chat with me!',
    ];
    await ctx.reply(help.join('\n'), { parse_mode: 'HTML' });
  }

  private async handleSkills(ctx: Context): Promise<void> {
    const skills = this.skillRegistry.getActiveSkills();
    if (!skills.length) {
      await ctx.reply('No skills available.');
      return;
    }

    const lines = ['<b>\u{1F9E0} Available Skills</b>', ''];
    for (const s of skills) {
      const label = this.skillRegistry.isBuiltin(s.name) ? 'builtin' : 'custom';
      const toolCount = s.tools.length;
      lines.push(`\u{2022} <b>${s.name}</b> <i>(${label}, ${toolCount} tool${toolCount !== 1 ? 's' : ''})</i>`);
      lines.push(`  ${s.description}`);
    }
    lines.push('', `<i>Ask me to use a skill and I'll activate it automatically.</i>`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  }

  private async handleMemory(ctx: Context): Promise<void> {
    const text = ctx.message?.text || '';
    const arg = text.replace(/^\/memory\s*/, '').trim();

    const category = arg || undefined;
    const memories = await this.memoryService.listAll(category, 20);

    if (!memories.length) {
      const msg = category
        ? `No memories found in category "<b>${this.escapeHtml(category)}</b>".`
        : 'No memories stored yet. I\'ll remember things as we chat!';
      await ctx.reply(msg, { parse_mode: 'HTML' });
      return;
    }

    // Group by category
    const grouped = new Map<string, typeof memories>();
    for (const m of memories) {
      const cat = m.category || 'general';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(m);
    }

    const lines = ['<b>\u{1F9E0} Stored Memories</b>'];
    if (category) {
      lines[0] += ` \u{2014} ${this.escapeHtml(category)}`;
    }
    lines.push('');

    for (const [cat, mems] of grouped) {
      const emoji = CATEGORY_EMOJI[cat] || '\u{1F4AC}';
      lines.push(`${emoji} <b>${this.escapeHtml(cat)}</b>`);
      for (const m of mems) {
        const tags = m.tags?.length ? ` <i>[${m.tags.join(', ')}]</i>` : '';
        const content = m.content.length > 100 ? m.content.slice(0, 100) + '\u{2026}' : m.content;
        lines.push(`  <code>${m.id}</code> ${this.escapeHtml(content)}${tags}`);
      }
      lines.push('');
    }

    const total = memories.length;
    lines.push(`<i>${total} memor${total === 1 ? 'y' : 'ies'} shown. Use /memory &lt;category&gt; to filter.</i>`);
    lines.push(`<i>Categories: ${[...grouped.keys()].join(', ')}</i>`);

    const html = lines.join('\n');
    for (const chunk of splitMessage(html)) {
      try {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      } catch {
        await ctx.reply(chunk);
      }
    }
  }

  private async handleTasks(ctx: Context): Promise<void> {
    const text = ctx.message?.text || '';
    const arg = text.replace(/^\/tasks\s*/, '').trim().toLowerCase();

    const userId = String(ctx.from!.id);

    let tasks;
    let filterLabel: string;

    if (arg === 'all') {
      tasks = await this.taskService.listTasks(undefined, userId);
      filterLabel = 'All';
    } else if (['scheduled', 'running', 'pending', 'completed', 'failed', 'cancelled'].includes(arg)) {
      tasks = await this.taskService.listTasks(arg, userId);
      filterLabel = arg.charAt(0).toUpperCase() + arg.slice(1);
    } else {
      const scheduled = await this.taskService.listTasks('scheduled', userId);
      const running = await this.taskService.listTasks('running', userId);
      const pending = await this.taskService.listTasks('pending', userId);
      tasks = [...running, ...scheduled, ...pending];
      filterLabel = 'Active';
    }

    if (!tasks.length) {
      const hint = arg
        ? `No <b>${this.escapeHtml(filterLabel.toLowerCase())}</b> tasks.`
        : 'No active tasks. Ask me to schedule something!';
      await ctx.reply(hint, { parse_mode: 'HTML' });
      return;
    }

    const lines = [`<b>\u{1F4CB} ${filterLabel} Tasks</b>`, ''];

    for (const t of tasks) {
      const emoji = STATUS_EMOJI[t.status] || '\u{2753}';
      const type = t.taskType === 'execution' ? '\u{2699}\u{FE0F}' : '\u{1F514}';
      lines.push(`${emoji} <b>${this.escapeHtml(t.title)}</b> ${type}`);

      const details: string[] = [];
      details.push(`ID: <code>${t.id}</code>`);
      details.push(`Status: ${t.status}`);
      if (t.cronExpression) details.push(`Cron: <code>${t.cronExpression}</code>`);
      if (t.scheduledAt) details.push(`Scheduled: ${this.formatDate(t.scheduledAt)}`);
      lines.push(`  ${details.join(' \u{2022} ')}`);

      if (t.description) {
        const desc = t.description.length > 80 ? t.description.slice(0, 80) + '\u{2026}' : t.description;
        lines.push(`  <i>${this.escapeHtml(desc)}</i>`);
      }
      lines.push('');
    }

    lines.push(`<i>${tasks.length} task${tasks.length !== 1 ? 's' : ''} shown.</i>`);
    lines.push('<i>Use /tasks all, /tasks completed, /tasks failed, etc.</i>');

    const html = lines.join('\n');
    for (const chunk of splitMessage(html)) {
      try {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      } catch {
        await ctx.reply(chunk);
      }
    }
  }

  private async handleCancel(ctx: Context): Promise<void> {
    const userId = String(ctx.from!.id);
    await this.agentQueue.cancelForUser(userId);
    await ctx.reply('Cancelled current agent loop.');
  }

  private async handleStop(ctx: Context): Promise<void> {
    const userId = String(ctx.from!.id);
    this.agentQueue.stopForUser(userId);
    await ctx.reply('Stopped current tool execution.');
  }

  private async handleClear(ctx: Context): Promise<void> {
    const userId = String(ctx.from!.id);
    await this.conversationService.softClear(userId);
    await ctx.reply('Conversation context cleared.');
  }

  // -- Message handling -------------------------------------------------------

  private async handleMessage(ctx: Context): Promise<void> {
    const userId = String(ctx.from!.id);

    // Sliding window rate limit
    const now = Date.now();
    const timestamps = this.userMessageTimestamps.get(userId) ?? [];
    const recent = timestamps.filter((t) => now - t < this.rateLimitWindow);
    if (recent.length >= this.rateLimitMax) {
      await ctx.reply('You\'re sending messages too fast. Please wait a moment before trying again.');
      return;
    }
    recent.push(now);
    this.userMessageTimestamps.set(userId, recent);

    // Build user message
    let userMessage: string | ContentBlock[];
    try {
      userMessage = await this.buildUserMessage(ctx);
    } catch (err) {
      if (err instanceof MediaDisabledError) {
        await ctx.reply(err.message);
        return;
      }
      throw err;
    }

    if (typeof userMessage === 'string' && !userMessage) return;

    try {
      const result = await this.agentQueue.enqueue(
        { userMessage, userId, channel: 'telegram', priority: AgentJobPriority.INTERACTIVE },
      );

      // Send final response
      if (result.text) {
        await this.sendTelegramMessage(ctx, result.text);
      }

      // Send files
      for (const filePath of result.files) {
        try {
          await this.sendFileByType(ctx, filePath);
        } catch (err) {
          this.logger.warn(`Failed to send file ${filePath}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Agent error for user ${userId}: ${err}`);
      try {
        await ctx.reply('Sorry, something went wrong while processing your message.');
      } catch {}
    }
  }

  // -- Response helpers -------------------------------------------------------

  private async sendTelegramMessage(ctx: Context, text: string): Promise<void> {
    const html = markdownToTelegramHtml(text);
    for (const chunk of splitMessage(html)) {
      try {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      } catch {
        try { await ctx.reply(chunk); } catch (err) {
          this.logger.warn(`Failed to send message: ${err}`);
        }
      }
    }
  }

  private async sendFileByType(ctx: Context, filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size > 50 * 1024 * 1024) return;

    const ext = path.extname(filePath).toLowerCase();
    const stream = fs.createReadStream(filePath);
    const inputFile = new InputFile(stream, path.basename(filePath));

    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      await ctx.replyWithPhoto(inputFile);
    } else if (['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(ext)) {
      await ctx.replyWithVideo(inputFile);
    } else if (['.mp3', '.ogg', '.opus', '.flac', '.wav', '.m4a', '.aac'].includes(ext)) {
      await ctx.replyWithAudio(inputFile);
    } else {
      await ctx.replyWithDocument(inputFile);
    }
  }

  // -- Media handling ---------------------------------------------------------

  private async buildUserMessage(ctx: Context): Promise<string | ContentBlock[]> {
    const msg = ctx.message!;
    const blocks: ContentBlock[] = [];

    if (msg.photo?.length) {
      if (!this.configService.get<boolean>('llm.photo_enabled')) {
        throw new MediaDisabledError('Photo support is not enabled.');
      }
      const photo = msg.photo[msg.photo.length - 1];
      const buffer = await this.downloadTelegramFile(ctx, photo.file_id);
      blocks.push({ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' });
    }

    const audio = msg.audio || msg.voice;
    if (audio) {
      if (!this.configService.get<boolean>('llm.audio_enabled')) {
        throw new MediaDisabledError('Audio support is not enabled.');
      }
      const buffer = await this.downloadTelegramFile(ctx, audio.file_id);
      const mimeType = audio.mime_type || ('voice' in msg && msg.voice ? 'audio/ogg' : 'audio/mpeg');
      blocks.push({ type: 'audio', data: buffer.toString('base64'), mimeType });
    }

    if (msg.video) {
      if (!this.configService.get<boolean>('llm.video_enabled')) {
        throw new MediaDisabledError('Video support is not enabled.');
      }
      if (msg.video.thumbnail) {
        const buffer = await this.downloadTelegramFile(ctx, msg.video.thumbnail.file_id);
        blocks.push({ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' });
      }
      blocks.push({ type: 'text', text: `[video: ${msg.video.file_name || 'video'}, duration: ${msg.video.duration}s]` });
    }

    if (msg.document) {
      if (!this.configService.get<boolean>('llm.document_enabled')) {
        throw new MediaDisabledError('Document support is not enabled.');
      }
      const buffer = await this.downloadTelegramFile(ctx, msg.document.file_id);
      const mimeType = msg.document.mime_type || 'application/octet-stream';
      blocks.push({ type: 'document', data: buffer.toString('base64'), mimeType, filename: msg.document.file_name || 'document' });
    }

    const text = msg.caption || msg.text;
    if (text) {
      blocks.push({ type: 'text', text });
    }

    if (blocks.length === 0) return text || '';
    if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text;
    return blocks;
  }

  private async downloadTelegramFile(ctx: Context, fileId: string): Promise<Buffer> {
    const file = await ctx.api.getFile(fileId);
    const token = this.configService.get<string>('channel.telegram.token')!;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(url);
    return Buffer.from(await response.arrayBuffer());
  }

  // -- Utilities --------------------------------------------------------------

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return iso;
    }
  }
}

class MediaDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaDisabledError';
  }
}
