export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// ── Multimodal content blocks ──────────────────────────────

export interface TextContent { type: 'text'; text: string; }
export interface ImageContent { type: 'image'; data: string; mimeType: string; }
export interface AudioContent { type: 'audio'; data: string; mimeType: string; }
export interface DocumentContent { type: 'document'; data: string; mimeType: string; filename: string; }
export type ContentBlock = TextContent | ImageContent | AudioContent | DocumentContent;

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string | ContentBlock[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** Extract plain text from a message's content (string or ContentBlock[]). */
export function getTextContent(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b): b is TextContent => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

export interface LLMResponse {
  message: LLMMessage;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface AgentResult {
  text: string;
  history: LLMMessage[];
  files: string[];
}
