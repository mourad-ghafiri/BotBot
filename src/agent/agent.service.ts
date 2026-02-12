import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { ILLMProvider, LLM_PROVIDER } from '../llm/llm.interface';
import { ContentBlock, LLMMessage, LLMResponse, ToolDefinition, AgentResult, getTextContent } from '../llm/llm.types';
import { ConversationService } from '../conversation/conversation.service';
import { SecurityGuardService } from '../security/security-guard.service';
import { SkillRegistryService } from '../skills/skill-registry.service';
import { ToolRouterService } from '../skills/tool-router.service';
import { MemoryService } from '../memory/memory.service';
import { MemoryExtractionService } from '../memory/memory-extraction.service';
import { PromptService } from './prompt.service';
import { ToolDispatcherService } from '../queue/tool-dispatcher.service';
import { ToolJobPriority, ToolJobResult } from '../queue/tool-job.types';
import { ProactiveEvaluatorService } from './proactive-evaluator.service';
import { TaskSchedulerService } from '../queue/task-scheduler.service';
import { TaskSchedulerRef } from '../task/task-scheduler.interface';
import { getInternalTools } from './tools';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly maxIterations: number;
  private readonly maxInputLength: number;
  private readonly historyLimit: number;
  private readonly memoryRetrievalLimit: number;
  private readonly securityEnabled: boolean;
  private readonly autoExtraction: boolean;
  private readonly proactiveEnabled: boolean;
  private botPersona = '';
  private userProfile = '';

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: ILLMProvider,
    private readonly conversationService: ConversationService,
    private readonly securityGuard: SecurityGuardService,
    private readonly skillRegistry: SkillRegistryService,
    private readonly memoryService: MemoryService,
    private readonly memoryExtraction: MemoryExtractionService,
    private readonly systemPromptBuilder: PromptService,
    private readonly toolRouter: ToolRouterService,
    private readonly toolDispatcher: ToolDispatcherService,
    private readonly proactiveEvaluator: ProactiveEvaluatorService,
    private readonly taskScheduler: TaskSchedulerService,
    private readonly config: ConfigService,
  ) {
    this.maxIterations = this.config.get('agent.max_iterations', 50);
    this.maxInputLength = this.config.get('agent.max_input_length', 16000);
    this.historyLimit = this.config.get('agent.history_limit', 100);
    this.memoryRetrievalLimit = this.config.get('agent.memory.retrieval_limit', 5);
    this.securityEnabled = this.config.get('agent.security.enabled', true);
    this.autoExtraction = this.config.get('agent.memory.auto_extraction', true);
    this.proactiveEnabled = this.config.get('agent.proactive.enabled', false);
  }

  setScheduler(scheduler: TaskSchedulerRef): void {
    this.toolRouter.setScheduler(scheduler);
  }

  loadPersona(botPersona: string, userProfile: string): void {
    this.botPersona = botPersona;
    this.userProfile = userProfile;
  }

  async run(params: {
    userMessage: string | ContentBlock[];
    userId?: string;
    channel?: string;
    progressCallback?: (text: string) => Promise<void>;
    skipSecurity?: boolean;
    disableTaskTools?: boolean;
    activateAllSkills?: boolean;
    signal?: AbortSignal;
    getToolSignal?: () => AbortSignal | undefined;
    priority?: number;
  }): Promise<AgentResult> {
    const { userMessage, userId, channel, progressCallback, skipSecurity, disableTaskTools, activateAllSkills, signal } = params;

    // Cancel any pending proactive follow-up on new user message
    if (this.proactiveEnabled && userId) {
      this.taskScheduler.cancelProactive(userId).catch(() => {});
    }

    // Extract text for validation, security, and logging
    const textForChecks = typeof userMessage === 'string'
      ? userMessage
      : userMessage.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');

    // Input length validation
    if (textForChecks.length > this.maxInputLength) {
      const truncated = `Your message is too long (${textForChecks.length} characters). The maximum is ${this.maxInputLength}. Please shorten your message and try again.`;
      return { text: truncated, history: [], files: [] };
    }

    // Load history
    let history: LLMMessage[] = [];
    let historyTruncated = false;
    if (userId) {
      history = await this.conversationService.getHistory(userId, this.historyLimit);
      if (history.length >= this.historyLimit) {
        historyTruncated = true;
      }
    }

    // Append user message
    const userMsg: LLMMessage = { role: 'user', content: userMessage };
    history.push(userMsg);
    if (userId) {
      await this.conversationService.append(userId, userMsg);
    }

    // Security check input
    if (this.securityEnabled && !skipSecurity) {
      const inputCheck = await this.securityGuard.checkInput(textForChecks);
      if (!inputCheck.safe) {
        this.logger.warn(`Security blocked input [${inputCheck.layer}]: ${inputCheck.reason}`);
        const blockedMsg = 'I\'m unable to process this message as it was flagged by the security system.';
        const blocked: LLMMessage = { role: 'assistant', content: blockedMsg };
        history.push(blocked);
        if (userId) await this.conversationService.append(userId, blocked);
        return { text: blockedMsg, history, files: [] };
      }
    }

    // Skill activation tracking
    const activatedSkills = new Set<string>();
    if (activateAllSkills) {
      for (const s of this.skillRegistry.getActiveSkills()) {
        activatedSkills.add(s.name);
      }
    }

    // Build prompt with memory context
    const memoryContext = await this.memoryService.buildMemoryContext(textForChecks, this.memoryRetrievalLimit);
    let systemPrompt = this.systemPromptBuilder.build(this.botPersona, this.userProfile, memoryContext, activatedSkills);
    if (historyTruncated) {
      systemPrompt += '\n\n[Note: Conversation history has been truncated to the most recent messages. Earlier messages may not be visible.]';
    }
    let tools = this.collectTools(disableTaskTools, activatedSkills);
    const turnStart = history.length - 1;

    const correlationId = `${userId || 'anon'}-${Date.now()}`;
    let iteration = 0;
    let finalText = '';
    let consecutiveErrorIterations = 0;
    let maxTokensContinuations = 0;

    this.logger.log(`Agent run | msg=${textForChecks.slice(0, 100)} | history=${history.length} | tools=${tools.length}`);

    // -- Agent loop --
    while (iteration < this.maxIterations) {
      iteration++;

      if (signal?.aborted) {
        this.logger.log(`Agent run aborted after ${iteration - 1} iterations`);
        finalText = 'Request cancelled.';
        const abortMsg: LLMMessage = { role: 'assistant', content: finalText };
        history.push(abortMsg);
        if (userId) await this.conversationService.append(userId, abortMsg);
        break;
      }

      let llmResponse: LLMResponse;
      try {
        llmResponse = await this.llm.sendMessage(history, tools.length ? tools : undefined, systemPrompt || undefined);
      } catch (err) {
        this.logger.error(`LLM error: ${err}`);
        const errorMsg: LLMMessage = { role: 'assistant', content: 'Sorry, I encountered an error processing your request.' };
        history.push(errorMsg);
        if (userId) await this.conversationService.append(userId, errorMsg);
        throw err;
      }

      const assistantContent = this.extractText(llmResponse.message);

      if (llmResponse.stopReason === 'tool_use' && llmResponse.message.toolCalls?.length) {
        history.push(llmResponse.message);
        if (userId) await this.conversationService.append(userId, llmResponse.message);

        // Forward intermediate text — skip short narration fragments
        const trimmed = assistantContent.trim();
        const isNarration = trimmed.endsWith(':') || trimmed.length < 80 || /^(Let me|I'll|I will|Now |OK|Alright)/i.test(trimmed);
        if (progressCallback && trimmed && !isNarration) {
          try { await progressCallback(trimmed); } catch {}
        }

        // Phase 1: Classify + dispatch
        const toolResults = new Map<string, { content: string; isError: boolean }>();
        const remotePromises = new Map<string, Promise<ToolJobResult>>();
        let activationHappened = false;

        for (const tc of llmResponse.message.toolCalls) {
          this.logger.log(`>> Tool: ${tc.name} | args=${JSON.stringify(tc.arguments).slice(0, 200)}`);

          if (tc.name === 'activate_skill') {
            const [content, isError] = this.toolRouter.handleSkillActivation(tc.arguments, activatedSkills);
            toolResults.set(tc.id, { content, isError });
            if (!isError && content.toLowerCase().includes('activated')) {
              activationHappened = true;
            }
          } else if (this.toolRouter.isLocalTool(tc.name)) {
            const [content, isError] = await this.toolRouter.executeTool(tc.name, { ...tc.arguments, _correlationId: correlationId }, userId);
            toolResults.set(tc.id, { content, isError });
          } else {
            const skillName = this.toolRouter.getSkillForTool(tc.name);
            if (!skillName) {
              toolResults.set(tc.id, { content: `Error: No skill for '${tc.name}'`, isError: true });
            } else {
              remotePromises.set(tc.id, this.toolDispatcher.dispatch({
                skillName,
                toolName: tc.name,
                args: tc.arguments,
                skillConfig: this.toolRouter.getSkillConfigForTool(tc.name),
                correlationId,
                priority: params.priority ?? ToolJobPriority.INTERACTIVE,
              }, params.getToolSignal?.() ?? signal));
            }
          }
        }

        // Phase 2: Await all remote jobs in parallel
        if (remotePromises.size) {
          const entries = [...remotePromises.entries()];
          const results = await Promise.allSettled(entries.map(([, p]) => p));
          for (let i = 0; i < entries.length; i++) {
            const r = results[i];
            toolResults.set(
              entries[i][0],
              r.status === 'fulfilled' ? r.value : { content: `Error: ${r.reason}`, isError: true },
            );
          }
        }

        // Phase 3: Append to history in original order
        let allToolsFailed = true;
        for (const tc of llmResponse.message.toolCalls) {
          const { content, isError } = toolResults.get(tc.id)!;
          if (isError) {
            this.logger.warn(`<< Tool ERROR [${tc.name}]: ${content.slice(0, 300)}`);
          } else {
            allToolsFailed = false;
          }
          const toolMsg: LLMMessage = { role: 'tool', content, toolCallId: tc.id };
          history.push(toolMsg);
          if (userId) await this.conversationService.append(userId, toolMsg);
        }

        // Circuit breaker: track consecutive error iterations
        if (allToolsFailed) {
          consecutiveErrorIterations++;
          if (consecutiveErrorIterations >= 3) {
            this.logger.warn(`Circuit breaker: ${consecutiveErrorIterations} consecutive error iterations`);
            const hintMsg: LLMMessage = {
              role: 'user',
              content: '[System: Multiple consecutive tool failures detected. Stop retrying failed tools and respond to the user with what you have, or explain what went wrong.]',
            };
            history.push(hintMsg);
            if (userId) await this.conversationService.append(userId, hintMsg);
          }
        } else {
          consecutiveErrorIterations = 0;
        }

        // Rebuild tools and prompt after skill activation
        if (activationHappened) {
          tools = this.collectTools(disableTaskTools, activatedSkills);
          systemPrompt = this.systemPromptBuilder.build(this.botPersona, this.userProfile, memoryContext, activatedSkills);
        }
        continue;
      }

      // Handle max_tokens — save partial response and continue
      if (llmResponse.stopReason === 'max_tokens') {
        this.logger.warn(`max_tokens hit at iteration ${iteration}`);
        maxTokensContinuations++;
        if (maxTokensContinuations <= 3) {
          history.push(llmResponse.message);
          if (userId) await this.conversationService.append(userId, llmResponse.message);
          const contMsg: LLMMessage = {
            role: 'user',
            content: '[System: Your response was truncated. Continue from where you left off. If you were constructing a tool call, make the complete call again.]',
          };
          history.push(contMsg);
          if (userId) await this.conversationService.append(userId, contMsg);
          continue;
        }
        this.logger.warn(`max_tokens: exhausted continuation attempts`);
      }

      // end_turn — check security before persisting
      finalText = assistantContent;
      if (this.securityEnabled && finalText && !skipSecurity) {
        const outputCheck = await this.securityGuard.checkOutput(finalText);
        if (!outputCheck.safe) {
          this.logger.warn(`Security blocked output [${outputCheck.layer}]: ${outputCheck.reason}`);
          finalText = 'The response was blocked by the security system because it may contain unsafe content.';
          llmResponse.message = { role: 'assistant', content: finalText };
        }
      }

      history.push(llmResponse.message);
      if (userId) await this.conversationService.append(userId, llmResponse.message);
      break;
    }

    if (iteration >= this.maxIterations && !finalText) {
      this.logger.warn(`Agent hit max iterations (${this.maxIterations})`);
      const lastMsg = history[history.length - 1];
      if (lastMsg?.role === 'assistant') {
        finalText = this.extractText(lastMsg);
      } else {
        finalText = 'I was unable to complete the request within the allowed iterations.';
        const fallbackMsg: LLMMessage = { role: 'assistant', content: finalText };
        history.push(fallbackMsg);
        if (userId) await this.conversationService.append(userId, fallbackMsg);
      }
    }

    const files = this.extractFiles(history, turnStart);

    // Cleanup browser session for this agent run
    this.toolRouter.cleanupBrowserSession(correlationId);

    // Auto-extract memories (fire-and-forget, non-blocking)
    if (this.autoExtraction && !skipSecurity) {
      const memoryAlreadyStored = this.memoryExtraction.memoryStoreWasUsed(history, turnStart);
      if (!memoryAlreadyStored) {
        this.memoryExtraction.autoExtractMemories(textForChecks, history, turnStart).catch((err) => {
          this.logger.debug(`Auto memory extraction error: ${err}`);
        });
      }
    }

    this.logger.log(`Agent done | iterations=${iteration} | response_len=${finalText.length} | files=${files.length}`);

    // Fire-and-forget proactivity evaluation
    if (this.proactiveEnabled && userId && channel) {
      this.evaluateProactivity(userId, history, memoryContext, channel).catch(() => {});
    }

    return { text: finalText, history, files };
  }

  // -- Proactivity ------------------------------------------------------------

  private async evaluateProactivity(userId: string, history: LLMMessage[], memoryContext: string, channel: string): Promise<void> {
    try {
      await this.taskScheduler.cancelProactive(userId);

      const recentHistory = history
        .filter((m) => m.role !== 'tool')
        .slice(-6);

      if (recentHistory.length < 2) return;

      const result = await this.proactiveEvaluator.evaluate({
        recentHistory,
        memoryContext,
        currentTime: new Date().toISOString(),
      });

      if (result) {
        await this.taskScheduler.scheduleProactive(userId, result.delayMinutes, result.message, channel);
        this.logger.log(`Proactive follow-up scheduled in ${result.delayMinutes}min`);
      }
    } catch (err) {
      this.logger.debug(`Proactive evaluation error: ${err}`);
    }
  }

  // -- Helpers ----------------------------------------------------------------

  private collectTools(disableTaskTools?: boolean, activatedSkills?: Set<string>): ToolDefinition[] {
    let tools = getInternalTools();
    if (disableTaskTools) {
      tools = tools.filter((t) => !t.name.startsWith('task_'));
    }
    if (activatedSkills?.size) {
      for (const skill of this.skillRegistry.getActiveSkills()) {
        if (activatedSkills.has(skill.name)) {
          tools.push(...skill.tools);
        }
      }
    }
    return tools;
  }

  private extractText(message: LLMMessage): string {
    return getTextContent(message);
  }

  private extractFiles(history: LLMMessage[], startIndex: number): string[] {
    const NEW_FILES_RE = /\[NEW_FILES\]\n(.*?)\n\[\/NEW_FILES\]/gs;
    const FILE_EXT_SRC = '\\.(?:png|jpg|jpeg|gif|webp|bmp|pdf|mp4|mkv|avi|mov|webm|mp3|ogg|opus|flac|wav|m4a|aac|doc|docx|xlsx|pptx|txt|csv|json|xml|srt|vtt|zip|tar|gz|rar|7z)';
    const BARE_PATH_RE = new RegExp(`([^\\s\`'"<>]+${FILE_EXT_SRC})`, 'gi');
    const QUOTED_PATH_RE = new RegExp(`"((?:\\/|[A-Za-z]:\\\\)[^"]+${FILE_EXT_SRC})"`, 'gi');

    const seen = new Set<string>();
    const paths: string[] = [];

    const addPath = (fp: string) => {
      if (!fp || seen.has(fp)) return;
      seen.add(fp);
      if (fs.existsSync(fp)) {
        paths.push(path.resolve(fp));
      }
    };

    for (const msg of history.slice(startIndex)) {
      if (msg.role !== 'tool') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';

      let match: RegExpExecArray | null;
      while ((match = NEW_FILES_RE.exec(content)) !== null) {
        for (const line of match[1].trim().split('\n')) {
          addPath(line.trim());
        }
      }

      let qMatch: RegExpExecArray | null;
      while ((qMatch = QUOTED_PATH_RE.exec(content)) !== null) {
        addPath(qMatch[1]);
      }

      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = BARE_PATH_RE.exec(content)) !== null) {
        addPath(fileMatch[1]);
      }
    }

    return paths;
  }
}
