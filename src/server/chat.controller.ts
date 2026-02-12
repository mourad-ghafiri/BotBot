import { Controller, Post, Body, Res, UseGuards, Get, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiKeyGuard } from './auth.guard';
import { ChatRequestDto } from './dto/chat-request.dto';
import { AgentQueueService } from '../queue/agent-queue.service';
import { AgentJobPriority } from '../queue/agent-job.types';
import { ConversationService } from '../conversation/conversation.service';
import { SkillRegistryService } from '../skills/skill-registry.service';

@Controller('api')
@UseGuards(ApiKeyGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly agentQueue: AgentQueueService,
    private readonly conversationService: ConversationService,
    private readonly skillRegistry: SkillRegistryService,
  ) {}

  @Post('chat')
  async chat(@Body() body: ChatRequestDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.sendSSE(res, 'status', { status: 'processing' });

    const userId = body.userId || 'api-default';
    let done = false;

    res.on('close', () => {
      if (!done) {
        this.agentQueue.cancelForUser(userId);
      }
      done = true;
    });

    try {
      const result = await this.agentQueue.enqueue(
        { userMessage: body.message, channel: 'api', userId, priority: AgentJobPriority.INTERACTIVE },
        {
          onProgress: async (text: string) => {
            if (!done) {
              this.sendSSE(res, 'progress', { text });
            }
          },
        },
      );

      if (!done) {
        done = true;
        this.sendSSE(res, 'response', { text: result.text, files: result.files });
        this.sendSSE(res, 'done', {});
        res.end();
      }
    } catch (err) {
      this.logger.error(`Chat error: ${err}`);
      if (!done) {
        done = true;
        this.sendSSE(res, 'error', { message: String(err) });
        res.end();
      }
    }
  }

  @Post('chat/cancel')
  async cancelChat(@Body() body: { userId?: string }): Promise<{ success: boolean }> {
    const userId = body?.userId || 'api-default';
    await this.agentQueue.cancelForUser(userId);
    this.logger.log(`Cancelled agent flow for user ${userId}`);
    return { success: true };
  }

  @Post('chat/stop')
  async stopChat(@Body() body: { userId?: string }): Promise<{ success: boolean }> {
    const userId = body?.userId || 'api-default';
    this.agentQueue.stopForUser(userId);
    this.logger.log(`Stopped tool execution for user ${userId}`);
    return { success: true };
  }

  @Get('skills')
  async getSkills(): Promise<any[]> {
    return this.skillRegistry.getActiveSkills().map((s) => ({
      name: s.name,
      description: s.description,
      active: s.active,
      toolCount: s.tools.length,
    }));
  }

  @Post('session/clear')
  async clearSession(@Body() body: { userId: string }): Promise<{ success: boolean }> {
    const userId = body.userId || 'default';
    await this.conversationService.softClear(userId);
    return { success: true };
  }

  private sendSSE(res: Response, event: string, data: any): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
