import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { EventBusService } from '../../events/event-bus.service';
import {
  BotEvent,
  NotificationSendPayload,
  FileSendPayload,
  ProactiveMessagePayload,
} from '../../events/events';

@Injectable()
export class TelegramListener implements OnModuleInit {
  private readonly logger = new Logger(TelegramListener.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(BotEvent.NOTIFICATION_SEND, (payload) => this.onNotification(payload));
    this.eventBus.subscribe(BotEvent.FILE_SEND, (payload) => this.onFile(payload));
    this.eventBus.subscribe(BotEvent.PROACTIVE_MESSAGE, (payload) => this.onProactiveMessage(payload));
  }

  /** Check if this event targets this channel. Broadcasts (no channel) go to all. */
  private shouldHandle(channel?: string): boolean {
    return !channel || channel === 'telegram';
  }

  async onNotification(payload: NotificationSendPayload): Promise<void> {
    if (!this.telegram.isEnabled || !this.shouldHandle(payload.channel)) return;

    if (payload.userId) {
      this.logger.log(`Sending notification to user ${payload.userId}: ${payload.title}`);
      try {
        await this.telegram.sendMessage(payload.userId, `<b>${payload.title}</b>\n\n${payload.body}`);
      } catch (err) {
        this.logger.error(`Failed to send notification to ${payload.userId}: ${err}`);
      }
    } else {
      this.logger.log(`Broadcasting notification to ${this.telegram.allowedUserIds.length} users: ${payload.title}`);
      for (const userId of this.telegram.allowedUserIds) {
        try {
          await this.telegram.sendMessage(userId, `<b>${payload.title}</b>\n\n${payload.body}`);
        } catch (err) {
          this.logger.error(`Failed to send notification to ${userId}: ${err}`);
        }
      }
    }
  }

  async onFile(payload: FileSendPayload): Promise<void> {
    if (!this.telegram.isEnabled || !this.shouldHandle(payload.channel)) return;

    if (payload.userId) {
      this.logger.log(`Sending file to user ${payload.userId}: ${payload.filePath}`);
      try {
        await this.telegram.sendFile(payload.userId, payload.filePath);
      } catch (err) {
        this.logger.error(`Failed to send file to ${payload.userId}: ${err}`);
      }
    } else {
      this.logger.log(`Broadcasting file to ${this.telegram.allowedUserIds.length} users: ${payload.filePath}`);
      for (const userId of this.telegram.allowedUserIds) {
        try {
          await this.telegram.sendFile(userId, payload.filePath);
        } catch (err) {
          this.logger.error(`Failed to send file to ${userId}: ${err}`);
        }
      }
    }
  }

  async onProactiveMessage(payload: ProactiveMessagePayload): Promise<void> {
    if (!this.telegram.isEnabled || !this.shouldHandle(payload.channel)) return;

    this.logger.log(`Sending proactive message to user ${payload.userId}`);
    try {
      await this.telegram.sendMessage(payload.userId, payload.message);
    } catch (err) {
      this.logger.error(`Failed to send proactive message to ${payload.userId}: ${err}`);
    }
  }
}
