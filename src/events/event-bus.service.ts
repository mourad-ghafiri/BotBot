import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { BotEvent } from './events';
import { parseRedisUrl } from '../utils/redis';

@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private pub: Redis;
  private sub: Redis;
  private readonly handlers = new Map<string, ((payload: any) => void)[]>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const opts = parseRedisUrl(this.config.get('queue.redis_url', 'redis://localhost:6379/0'));
    this.pub = new Redis(opts);
    this.sub = new Redis(opts);

    this.sub.on('message', (channel: string, message: string) => {
      const event = channel.replace('botbot:events:', '');
      const handlers = this.handlers.get(event) || [];
      try {
        const payload = JSON.parse(message);
        for (const h of handlers) {
          try {
            h(payload);
          } catch (err) {
            this.logger.error(`EventBus handler error for '${event}': ${err}`);
          }
        }
      } catch (err) {
        this.logger.error(`EventBus message parse error on '${channel}': ${err}`);
      }
    });

    this.logger.log('EventBus connected to Redis');
  }

  async publish(event: BotEvent, payload: any): Promise<void> {
    await this.pub.publish(`botbot:events:${event}`, JSON.stringify(payload));
  }

  subscribe(event: BotEvent, handler: (payload: any) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
      this.sub.subscribe(`botbot:events:${event}`);
    }
    this.handlers.get(event)!.push(handler);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pub?.quit();
    await this.sub?.quit();
  }
}
