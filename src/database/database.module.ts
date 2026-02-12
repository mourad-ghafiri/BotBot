import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DB_PATH } from '../cli/paths';
import { Conversation } from './entities/conversation.entity';
import { Memory } from './entities/memory.entity';
import { Task } from './entities/task.entity';

const entities = [Conversation, Memory, Task];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      location: DB_PATH,
      autoSave: true,
      entities,
      synchronize: true,
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
