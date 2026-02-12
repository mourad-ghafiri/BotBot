import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Conversation } from '../database/entities/conversation.entity';
import { ContentBlock, LLMMessage } from '../llm/llm.types';

@Injectable()
export class ConversationService {
  private readonly clearPoints = new Map<string, number>();

  constructor(
    @InjectRepository(Conversation)
    private readonly repo: Repository<Conversation>,
  ) {}

  async append(userId: string, message: LLMMessage): Promise<void> {
    const now = new Date().toISOString();
    const isMultimodal = Array.isArray(message.content);
    const entity = this.repo.create({
      userId,
      role: message.role,
      content: isMultimodal ? JSON.stringify(message.content) : (message.content as string) ?? null,
      toolCalls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      toolCallId: message.toolCallId ?? null,
      createdAt: now,
      metadata: isMultimodal ? { multimodal: true } : {},
    });
    await this.repo.save(entity);
  }

  async getHistory(userId: string, limit = 100): Promise<LLMMessage[]> {
    const clearPoint = this.clearPoints.get(userId);
    const where: any = { userId };
    if (clearPoint) {
      where.id = MoreThan(clearPoint);
    }
    const rows = await this.repo.find({
      where,
      order: { id: 'DESC' },
      take: limit,
    });
    rows.reverse();

    return rows.map((row) => {
      let toolCalls: any[] | undefined;
      if (row.toolCalls) {
        try {
          toolCalls = JSON.parse(row.toolCalls);
        } catch {
          toolCalls = undefined;
        }
      }
      let content: string | ContentBlock[] | undefined = row.content ?? undefined;
      if (row.metadata?.multimodal && typeof content === 'string') {
        try {
          content = JSON.parse(content) as ContentBlock[];
        } catch {
          // leave as string if parse fails
        }
      }
      return {
        role: row.role as LLMMessage['role'],
        content,
        toolCalls,
        toolCallId: row.toolCallId ?? undefined,
      };
    });
  }

  async clear(userId: string): Promise<void> {
    await this.repo.delete({ userId });
    this.clearPoints.delete(userId);
  }

  async softClear(userId: string): Promise<void> {
    const latest = await this.repo.findOne({
      where: { userId },
      order: { id: 'DESC' },
      select: ['id'],
    });
    if (latest) {
      this.clearPoints.set(userId, latest.id);
    }
  }

  async count(userId: string): Promise<number> {
    return this.repo.count({ where: { userId } });
  }

  async getLastMessageTime(userId: string): Promise<string | null> {
    const row = await this.repo.findOne({
      where: { userId },
      order: { id: 'DESC' },
      select: ['createdAt'],
    });
    return row?.createdAt ?? null;
  }
}
