import { LLMMessage, LLMResponse, ToolDefinition } from './llm.types';

export interface ILLMProvider {
  sendMessage(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    system?: string,
  ): Promise<LLMResponse>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
