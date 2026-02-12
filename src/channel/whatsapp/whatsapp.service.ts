import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentQueueService } from '../../queue/agent-queue.service';
import { ConversationService } from '../../conversation/conversation.service';
import { WhatsAppHandlers } from './whatsapp.handlers';

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private client: any = null;
  private enabled: boolean;
  private allowedNumbers: string[];
  private handlers: WhatsAppHandlers;

  constructor(
    private readonly config: ConfigService,
    private readonly agentQueue: AgentQueueService,
    private readonly conversationService: ConversationService,
  ) {
    this.enabled = this.config.get('channel.whatsapp.enabled', false);
    this.allowedNumbers = this.config.get('channel.whatsapp.allowed_numbers', []);
    this.handlers = new WhatsAppHandlers(
      this.agentQueue,
      this.conversationService,
      this.allowedNumbers,
      (phone, text) => this.sendMessage(phone, text),
      (phone, filePath) => this.sendFile(phone, filePath),
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled || process.env.BOTBOT_WORKER_MODE) {
      this.logger.log('WhatsApp channel disabled');
      return;
    }

    try {
      const { Client, LocalAuth } = await import('whatsapp-web.js');

      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: 'workspace/.wwebjs_auth' }),
        puppeteer: { headless: true, args: ['--no-sandbox'] },
      });

      this.client.on('qr', (qr: string) => {
        this.logger.log('WhatsApp QR code received. Scan it to authenticate:');
        try {
          const qrcode = require('qrcode-terminal');
          qrcode.generate(qr, { small: true });
        } catch {
          this.logger.log(`QR: ${qr}`);
        }
      });

      this.client.on('ready', () => {
        this.logger.log('WhatsApp client ready');
      });

      this.client.on('message', async (msg: any) => {
        if (msg.from.endsWith('@c.us') && msg.body) {
          const phoneNumber = msg.from.replace('@c.us', '');
          await this.handlers.handleMessage(phoneNumber, msg.body);
        }
      });

      await this.client.initialize();
    } catch (err) {
      this.logger.error(`Failed to initialize WhatsApp: ${err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try { await this.client.destroy(); } catch {}
      this.logger.log('WhatsApp client destroyed');
    }
  }

  async sendMessage(phoneNumber: string, text: string): Promise<void> {
    if (!this.client) return;
    const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
    await this.client.sendMessage(chatId, text);
  }

  async sendFile(phoneNumber: string, filePath: string): Promise<void> {
    if (!this.client) return;
    const fs = await import('fs');
    if (!fs.existsSync(filePath)) return;
    const { MessageMedia } = await import('whatsapp-web.js');
    const media = MessageMedia.fromFilePath(filePath);
    const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
    await this.client.sendMessage(chatId, media);
  }

  get isEnabled(): boolean { return this.enabled && !!this.client; }
  get allowedPhoneNumbers(): string[] { return this.allowedNumbers; }
}
