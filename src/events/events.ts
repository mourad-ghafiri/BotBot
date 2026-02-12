export enum BotEvent {
  // Task lifecycle
  TASK_CREATED = 'task.created',
  TASK_STARTED = 'task.started',
  TASK_COMPLETED = 'task.completed',
  TASK_FAILED = 'task.failed',
  TASK_CANCELLED = 'task.cancelled',
  // Delivery (userId: null = broadcast, string = targeted)
  NOTIFICATION_SEND = 'notification.send',
  FILE_SEND = 'file.send',
  // Proactive
  PROACTIVE_MESSAGE = 'proactive.message',
  // Skills
  SKILL_REGISTERED = 'skill.registered',
}

// -- Task lifecycle payloads -------------------------------------------------

export interface TaskCreatedPayload {
  taskId: string;
  userId: string | null;
  title: string;
  taskType: string;
  scheduledAt?: string;
  cronExpression?: string;
}

export interface TaskStartedPayload {
  taskId: string;
  title: string;
  taskType: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  title: string;
  taskType: string;
  output: string;
  files: string[];
  isCron: boolean;
}

export interface TaskFailedPayload {
  taskId: string;
  title: string;
  error: string;
}

export interface TaskCancelledPayload {
  taskId: string;
  title: string;
  cancelledDuringExecution: boolean;
}

// -- Delivery payloads -------------------------------------------------------

export interface NotificationSendPayload {
  title: string;
  body: string;
  userId: string | null;
  channel?: string;
}

export interface FileSendPayload {
  filePath: string;
  userId: string | null;
  channel?: string;
}

// -- Skill payloads ----------------------------------------------------------

export interface SkillRegisteredPayload {
  name: string;
}

// -- Proactive payload -------------------------------------------------------

export interface ProactiveMessagePayload {
  userId: string;
  message: string;
  channel?: string;
}

