import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Task } from '../database/entities/task.entity';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(Task)
    private readonly repo: Repository<Task>,
  ) {}

  async create(params: {
    title: string;
    description?: string;
    status?: string;
    taskType?: string;
    userId?: string;
    scheduledAt?: string;
    cronExpression?: string;
    metadata?: Record<string, any>;
  }): Promise<Task> {
    const now = new Date().toISOString();
    const entity = this.repo.create({
      id: randomUUID().slice(0, 8),
      title: params.title,
      description: params.description ?? null,
      status: params.status ?? 'pending',
      taskType: params.taskType ?? 'reminder',
      userId: params.userId ?? null,
      createdAt: now,
      updatedAt: now,
      scheduledAt: params.scheduledAt ?? null,
      cronExpression: params.cronExpression ?? null,
      metadata: params.metadata ?? {},
    });
    return this.repo.save(entity);
  }

  async get(taskId: string): Promise<Task | null> {
    return this.repo.findOne({ where: { id: taskId } });
  }

  async update(taskId: string, updates: Partial<Task>): Promise<Task | null> {
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    return this.repo.save(task);
  }

  async delete(taskId: string): Promise<boolean> {
    const result = await this.repo.delete(taskId);
    return (result.affected ?? 0) > 0;
  }

  async incrementFailureCount(taskId: string): Promise<number> {
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) return 0;
    task.failureCount = (task.failureCount || 0) + 1;
    task.updatedAt = new Date().toISOString();
    await this.repo.save(task);
    return task.failureCount;
  }

  async resetFailureCount(taskId: string): Promise<void> {
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) return;
    task.failureCount = 0;
    task.updatedAt = new Date().toISOString();
    await this.repo.save(task);
  }

  async listTasks(status?: string, userId?: string): Promise<Task[]> {
    const where: any = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }
}
