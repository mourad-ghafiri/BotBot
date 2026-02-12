import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Memory } from '../database/entities/memory.entity';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @InjectRepository(Memory)
    private readonly repo: Repository<Memory>,
  ) {}

  async store(
    content: string,
    category = 'general',
    tags: string[] = [],
    metadata: Record<string, any> = {},
    source = 'manual',
    importance = 0.5,
  ): Promise<string> {
    const id = randomUUID().slice(0, 12);
    const now = new Date().toISOString();
    const entity = this.repo.create({
      id,
      content,
      category,
      tags,
      createdAt: now,
      metadata,
      importance,
      lastAccessedAt: null,
      accessCount: 0,
      source,
    });
    await this.repo.save(entity);
    return id;
  }

  /**
   * Retrieve memories relevant to a query using SQL-level filtering + application-level scoring.
   * Scores by term matches (content, tags, category) with recency and importance boosts.
   * Automatically tracks access on returned results.
   */
  async retrieve(query: string, limit = 10): Promise<Memory[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    if (!terms.length) return [];

    // SQL-level filtering: any term matches content, tags, or category
    const qb = this.repo.createQueryBuilder('m');
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    terms.forEach((term, i) => {
      conditions.push(
        `(LOWER(m.content) LIKE :t${i} OR LOWER(m.tags) LIKE :t${i} OR LOWER(m.category) LIKE :t${i})`,
      );
      params[`t${i}`] = `%${term}%`;
    });

    qb.where(conditions.join(' OR '), params);
    const candidates = await qb.getMany();

    // Application-level scoring
    const now = Date.now();
    const scored = candidates.map((entry) => {
      const contentLower = entry.content.toLowerCase();
      const tagsStr = (entry.tags || []).join(' ').toLowerCase();
      const catLower = entry.category.toLowerCase();

      let score = 0;

      // Term match scoring
      for (const term of terms) {
        if (contentLower.includes(term)) score += 2;
        if (tagsStr.includes(term)) score += 3;
        if (catLower.includes(term)) score += 1;
      }

      // Recency boost: newer memories score higher (decay over 30 days)
      const createdMs = new Date(entry.createdAt).getTime();
      const ageDays = (now - createdMs) / 86_400_000;
      score += Math.max(0, 1 - ageDays / 30);

      // Importance boost (0-1 range, scaled to 0-2)
      score += (entry.importance ?? 0.5) * 2;

      // Access frequency boost (diminishing returns)
      if (entry.accessCount > 0) {
        score += Math.log2(entry.accessCount + 1) * 0.5;
      }

      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit).map((s) => s.entry);

    // Track access (fire-and-forget)
    if (results.length) {
      this.recordAccess(results.map((r) => r.id)).catch(() => {});
    }

    return results;
  }

  async listAll(category?: string, limit = 50): Promise<Memory[]> {
    const where: any = {};
    if (category) where.category = category;
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getById(memoryId: string): Promise<Memory | null> {
    return this.repo.findOne({ where: { id: memoryId } });
  }

  async update(
    memoryId: string,
    updates: Partial<Pick<Memory, 'content' | 'category' | 'tags' | 'metadata' | 'importance'>>,
  ): Promise<Memory | null> {
    const entry = await this.repo.findOne({ where: { id: memoryId } });
    if (!entry) return null;

    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.metadata !== undefined) entry.metadata = updates.metadata;
    if (updates.importance !== undefined) entry.importance = updates.importance;

    return this.repo.save(entry);
  }

  async delete(memoryId: string): Promise<boolean> {
    const result = await this.repo.delete(memoryId);
    return (result.affected ?? 0) > 0;
  }

  /**
   * Find memories with similar content (for deduplication).
   * Extracts significant words and scores overlap.
   */
  async buildMemoryContext(query: string, limit = 5): Promise<string> {
    try {
      const memories = await this.retrieve(query, limit);
      if (!memories.length) return '';

      const lines = ['[RELEVANT MEMORIES]'];
      for (const m of memories) {
        const tags = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
        lines.push(`- (${m.category || 'general'}) ${m.content}${tags}`);
      }
      return lines.join('\n');
    } catch (err) {
      this.logger.warn(`Failed to retrieve memories: ${err}`);
      return '';
    }
  }

  async findSimilar(content: string, threshold = 0.4, limit = 5): Promise<Memory[]> {
    const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const unique = [...new Set(words)].slice(0, 8);
    if (!unique.length) return [];

    const qb = this.repo.createQueryBuilder('m');
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    unique.forEach((word, i) => {
      conditions.push(`LOWER(m.content) LIKE :w${i}`);
      params[`w${i}`] = `%${word}%`;
    });

    qb.where(conditions.join(' OR '), params);
    const candidates = await qb.getMany();

    const scored = candidates.map((entry) => {
      const contentLower = entry.content.toLowerCase();
      const matches = unique.filter((w) => contentLower.includes(w)).length;
      return { entry, overlap: matches / unique.length };
    });

    return scored
      .filter((s) => s.overlap >= threshold)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  /**
   * Batch update access counts and timestamps for retrieved memories.
   */
  private async recordAccess(ids: string[]): Promise<void> {
    const now = new Date().toISOString();
    await this.repo
      .createQueryBuilder()
      .update()
      .set({
        accessCount: () => 'accessCount + 1',
        lastAccessedAt: now,
      })
      .whereInIds(ids)
      .execute();
  }
}
