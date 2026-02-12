import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('memories')
export class Memory {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  content: string;

  @Column('text', { default: 'general' })
  category: string;

  @Column('simple-json', { default: '[]' })
  tags: string[];

  @Column('text')
  createdAt: string;

  @Column('simple-json', { default: '{}' })
  metadata: Record<string, any>;

  @Column('real', { default: 0.5 })
  importance: number;

  @Column('text', { nullable: true })
  lastAccessedAt: string | null;

  @Column('integer', { default: 0 })
  accessCount: number;

  @Column('text', { default: 'manual' })
  source: string;
}
