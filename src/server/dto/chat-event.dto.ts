export interface ChatEvent {
  event: 'status' | 'progress' | 'response' | 'error' | 'done';
  data: Record<string, any>;
}

export interface NotificationEvent {
  event: 'notification' | 'task-completed' | 'task-failed';
  data: Record<string, any>;
}
