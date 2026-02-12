import { ToolDefinition } from '../llm/llm.types';

export function getInternalTools(): ToolDefinition[] {
  return [
    // Memory tools
    {
      name: 'memory_store',
      description: 'Store a fact, preference, or piece of information for long-term recall.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact or information to remember.' },
          category: {
            type: 'string',
            description: 'Category: personal, preference, project, decision, system, or general.',
            enum: ['personal', 'preference', 'project', 'decision', 'system', 'general'],
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short tags for retrieval.',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'memory_retrieve',
      description: 'Search memories by relevance to a query.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: { type: 'integer', description: 'Max results (default 5).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_list',
      description: 'List all stored memories, optionally filtered by category.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category filter.' },
          limit: { type: 'integer', description: 'Max results (default 50).' },
        },
      },
    },
    {
      name: 'memory_delete',
      description: 'Delete a memory by its ID.',
      input_schema: {
        type: 'object',
        properties: {
          memory_id: { type: 'string', description: 'ID of the memory to delete.' },
        },
        required: ['memory_id'],
      },
    },
    {
      name: 'memory_update',
      description: "Update a memory's content, category, or tags.",
      input_schema: {
        type: 'object',
        properties: {
          memory_id: { type: 'string', description: 'ID of the memory to update.' },
          content: { type: 'string', description: 'New content.' },
          category: { type: 'string', description: 'New category.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'New tags.' },
        },
        required: ['memory_id'],
      },
    },
    // Task tools
    {
      name: 'task_create',
      description:
        "Create a new task or schedule one for later. Use task_type='reminder' (default) for notification-only tasks, or task_type='execution' for tasks where the agent runs with skills to produce a result.",
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title.' },
          description: { type: 'string', description: 'Task details (used as the agent prompt for execution tasks).' },
          scheduled_at: { type: 'string', description: 'ISO datetime for one-off scheduling.' },
          cron_expression: { type: 'string', description: 'Cron expression for recurring tasks.' },
          task_type: {
            type: 'string',
            description: "Type of task: 'reminder' sends a notification, 'execution' runs the agent with skills.",
            enum: ['reminder', 'execution'],
            default: 'reminder',
          },
        },
        required: ['title'],
      },
    },
    {
      name: 'task_list',
      description:
        "List tasks, optionally filtered by status. Call with no status filter to see all tasks. Recurring/cron tasks have status 'scheduled'. To find tasks to cancel, omit the status filter or use status='scheduled'.",
      input_schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status. Omit to see all tasks.',
            enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'scheduled', 'running'],
          },
        },
      },
    },
    {
      name: 'task_update',
      description: "Update a task's status, title, or description.",
      input_schema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'ID of the task.' },
          status: { type: 'string', description: 'New status.' },
          title: { type: 'string', description: 'New title.' },
          description: { type: 'string', description: 'New description.' },
        },
        required: ['task_id'],
      },
    },
    {
      name: 'task_cancel',
      description:
        "Cancel a task by ID. Stops its schedule (cron or one-off), stops any running execution, and marks it as cancelled. To find the task ID, first call task_list without a status filter (or with status='scheduled' for cron tasks). Works on tasks with any active status: 'scheduled', 'running', 'pending'.",
      input_schema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'ID of the task to cancel.' },
        },
        required: ['task_id'],
      },
    },
    // Skill activation
    {
      name: 'activate_skill',
      description:
        'Activate a skill to use its tools. You MUST call this before using any skill tool. Returns the skill\'s available tools and usage instructions.',
      input_schema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Name of the skill to activate.' },
        },
        required: ['skill_name'],
      },
    },
  ];
}
