import { Injectable, OnModuleInit } from '@nestjs/common';
import { SseService } from './sse.service';
import { EventBusService } from '../events/event-bus.service';
import { BotEvent, NotificationSendPayload, FileSendPayload, ProactiveMessagePayload } from '../events/events';

@Injectable()
export class ServerListener implements OnModuleInit {
  constructor(
    private readonly sse: SseService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(BotEvent.NOTIFICATION_SEND, (payload) => this.onNotification(payload));
    this.eventBus.subscribe(BotEvent.FILE_SEND, (payload) => this.onFile(payload));
    this.eventBus.subscribe(BotEvent.PROACTIVE_MESSAGE, (payload) => this.onProactiveMessage(payload));
  }

  /** Check if this event should be handled by the server listener. */
  private shouldHandle(channel?: string): boolean {
    return !channel || channel === 'server';
  }

  onNotification(payload: NotificationSendPayload): void {
    if (!this.shouldHandle(payload.channel)) return;

    if (payload.userId) {
      this.sse.pushEvent(payload.userId, 'notification', { title: payload.title, body: payload.body });
    } else {
      this.sse.pushToAll('notification', { title: payload.title, body: payload.body });
    }
  }

  onFile(payload: FileSendPayload): void {
    if (!this.shouldHandle(payload.channel)) return;

    if (payload.userId) {
      this.sse.pushEvent(payload.userId, 'task-file', { filePath: payload.filePath });
    } else {
      this.sse.pushToAll('task-file', { filePath: payload.filePath });
    }
  }

  onProactiveMessage(payload: ProactiveMessagePayload): void {
    if (!this.shouldHandle(payload.channel)) return;
    this.sse.pushEvent(payload.userId, 'notification', { body: payload.message });
  }
}
