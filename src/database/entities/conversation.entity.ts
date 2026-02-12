import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('conversations')
@Index(['userId', 'id'])
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('text')
  userId: string;

  @Column('text')
  role: string;

  @Column('text', { nullable: true })
  content: string | null;

  @Column('text', { nullable: true })
  toolCalls: string | null;

  @Column('text', { nullable: true })
  toolCallId: string | null;

  @Column('text')
  createdAt: string;

  @Column('simple-json', { default: '{}' })
  metadata: Record<string, any>;
}
