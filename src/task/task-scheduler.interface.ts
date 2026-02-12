export interface TaskSchedulerRef {
  scheduleTask(taskId: string, runDate: Date): Promise<void>;
  registerCron(taskId: string, cronExpr: string): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
}
