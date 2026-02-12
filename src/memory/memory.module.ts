import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Memory } from '../database/entities/memory.entity';
import { LLMModule } from '../llm/llm.module';
import { MemoryService } from './memory.service';
import { MemoryExtractionService } from './memory-extraction.service';

@Module({
  imports: [TypeOrmModule.forFeature([Memory]), LLMModule],
  providers: [MemoryService, MemoryExtractionService],
  exports: [MemoryService, MemoryExtractionService],
})
export class MemoryModule {}
