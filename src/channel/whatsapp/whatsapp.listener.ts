import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { EventBusService } from '../../events/event-bus.service';
import {
  BotEvent,
  NotificationSendPayload,
  FileSendPayload,
  ProactiveMessagePayload,
} from '../../events/events';

@Injectable()
export class WhatsAppListener implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppListener.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(BotEvent.NOTIFICATION_SEND, (payload) => this.onNotification(payload));
    this.eventBus.subscribe(BotEvent.FILE_SEND, (payload) => this.onFile(payload));
    this.eventBus.subscribe(BotEvent.PROACTIVE_MESSAGE, (payload) => this.onProactiveMessage(payload));
  }

  private shouldHandle(channel?: string): boolean {
    return !channel || channel === 'whatsapp';
  }

  async onNotification(payload: NotificationSendPayload): Promise<void> {
    if (!this.whatsapp.isEnabled || !this.shouldHandle(payload.channel)) return;

    if (payload.userId) {
      try {
        await this.whatsapp.sendMessage(payload.userId, `*${payload.title}*\n\n${payload.body}`);
      } catch (err) {
        this.logger.error(`Failed to send notification to ${payload.userId}: ${err}`);
      }
    } else {
      for (const phoneNumber of this.whatsapp.allowedPhoneNumbers) {
        try {
          await this.whatsapp.sendMessage(phoneNumber, `*${payload.title}*\n\n${payload.body}`);
        } catch (err) {
          this.logger.error(`Failed to send notification to ${phoneNumber}: ${err}`);
        }
      }
    }
  }

  async onFile(payload: FileSendPayload): Promise<void> {
    if (!this.whatsapp.isEnabled || !this.shouldHandle(payload.channel)) return;

    if (payload.userId) {
      try {
        await this.whatsapp.sendFile(payload.userId, payload.filePath);
      } catch (err) {
        this.logger.error(`Failed to send file to ${payload.userId}: ${err}`);
      }
    } else {
      for (const phoneNumber of this.whatsapp.allowedPhoneNumbers) {
        try {
          await this.whatsapp.sendFile(phoneNumber, payload.filePath);
        } catch (err) {
          this.logger.error(`Failed to send file to ${phoneNumber}: ${err}`);
        }
      }
    }
  }

  async onProactiveMessage(payload: ProactiveMessagePayload): Promise<void> {
    if (!this.whatsapp.isEnabled || !this.shouldHandle(payload.channel)) return;

    try {
      await this.whatsapp.sendMessage(payload.userId, payload.message);
    } catch (err) {
      this.logger.error(`Failed to send proactive message to ${payload.userId}: ${err}`);
    }
  }
}
