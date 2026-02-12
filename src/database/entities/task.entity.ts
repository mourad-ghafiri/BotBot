import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('tasks')
export class Task {
  @PrimaryColumn('text')
  id: string;

  @Column('text')
  title: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('text', { default: 'pending' })
  status: string;

  @Column('text', { default: 'reminder' })
  taskType: string;

  @Column('text', { nullable: true })
  userId: string | null;

  @Column('text')
  createdAt: string;

  @Column('text')
  updatedAt: string;

  @Column('text', { nullable: true })
  scheduledAt: string | null;

  @Column('text', { nullable: true })
  cronExpression: string | null;

  @Column('integer', { default: 0 })
  failureCount: number;

  @Column('simple-json', { default: '{}' })
  metadata: Record<string, any>;
}
