import { Injectable, OnModuleInit } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { EventBusService } from '../../events/event-bus.service';
import { BotEvent, NotificationSendPayload, FileSendPayload, ProactiveMessagePayload } from '../../events/events';

@Injectable()
export class WebhookListener implements OnModuleInit {
  constructor(
    private readonly webhook: WebhookService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(BotEvent.NOTIFICATION_SEND, (payload) => this.onNotification(payload));
    this.eventBus.subscribe(BotEvent.FILE_SEND, (payload) => this.onFile(payload));
    this.eventBus.subscribe(BotEvent.PROACTIVE_MESSAGE, (payload) => this.onProactiveMessage(payload));
  }

  /** Check if this event should be handled by the webhook listener. */
  private shouldHandle(channel?: string): boolean {
    return !channel || channel === 'webhook';
  }

  async onNotification(payload: NotificationSendPayload): Promise<void> {
    if (!this.shouldHandle(payload.channel)) return;
    await this.webhook.sendNotification(payload.userId ?? '*', payload.title, payload.body);
  }

  async onFile(payload: FileSendPayload): Promise<void> {
    if (!this.shouldHandle(payload.channel)) return;
    await this.webhook.sendFile(payload.userId ?? '*', payload.filePath);
  }

  async onProactiveMessage(payload: ProactiveMessagePayload): Promise<void> {
    if (!this.shouldHandle(payload.channel)) return;
    await this.webhook.sendMessage(payload.userId, payload.message);
  }
}
