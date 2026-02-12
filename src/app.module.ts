import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ConversationModule } from './conversation/conversation.module';
import { MemoryModule } from './memory/memory.module';
import { TaskModule } from './task/task.module';
import { LLMModule } from './llm/llm.module';
import { SecurityModule } from './security/security.module';
import { SkillsModule } from './skills/skills.module';
import { AgentModule } from './agent/agent.module';
import { QueueModule } from './queue/queue.module';
import { ServerModule } from './server/server.module';
import { ChannelModule } from './channel/channel.module';
import { EventsModule } from './events/events.module';
import { BootstrapService } from './bootstrap.service';
import { parseRedisUrl } from './utils/redis';

@Module({
  imports: [
    AppConfigModule,
    EventsModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: parseRedisUrl(config.get('queue.redis_url', 'redis://localhost:6379/0')),
      }),
    }),
    DatabaseModule,
    ConversationModule,
    MemoryModule,
    TaskModule,
    LLMModule,
    SecurityModule,
    SkillsModule,
    AgentModule,
    QueueModule,
    ServerModule,
    ChannelModule,
  ],
  providers: [BootstrapService],
})
export class AppModule {}
