import { Logger } from '@nestjs/common';
import { AgentQueueService } from '../../queue/agent-queue.service';
import { AgentJobPriority } from '../../queue/agent-job.types';
import { ConversationService } from '../../conversation/conversation.service';

export class WhatsAppHandlers {
  private readonly logger = new Logger(WhatsAppHandlers.name);

  constructor(
    private readonly agentQueue: AgentQueueService,
    private readonly conversationService: ConversationService,
    private readonly allowedNumbers: string[],
    private readonly sendMessage: (phoneNumber: string, text: string) => Promise<void>,
    private readonly sendFile: (phoneNumber: string, filePath: string) => Promise<void>,
  ) {}

  async handleMessage(phoneNumber: string, text: string): Promise<void> {
    if (this.allowedNumbers.length && !this.allowedNumbers.includes(phoneNumber)) {
      this.logger.warn(`Unauthorized WhatsApp message from ${phoneNumber}`);
      return;
    }

    const userId = phoneNumber;

    const cmd = text.trim().toLowerCase();

    if (cmd === '/cancel') {
      await this.agentQueue.cancelForUser(userId);
      try { await this.sendMessage(phoneNumber, 'Cancelled current agent loop.'); } catch {}
      return;
    }

    if (cmd === '/stop') {
      this.agentQueue.stopForUser(userId);
      try { await this.sendMessage(phoneNumber, 'Stopped current tool execution.'); } catch {}
      return;
    }

    if (cmd === '/clear') {
      await this.conversationService.softClear(userId);
      try { await this.sendMessage(phoneNumber, 'Conversation context cleared.'); } catch {}
      return;
    }

    try {
      const result = await this.agentQueue.enqueue(
        { userMessage: text, channel: 'whatsapp', userId, priority: AgentJobPriority.INTERACTIVE },
        {
          onProgress: async (progressText: string) => {
            await this.sendMessage(phoneNumber, progressText);
          },
        },
      );

      if (result.text) {
        await this.sendMessage(phoneNumber, result.text);
      }

      for (const filePath of result.files) {
        try {
          await this.sendFile(phoneNumber, filePath);
        } catch (err) {
          this.logger.warn(`Failed to send file ${filePath}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Agent error for user ${userId}: ${err}`);
      try {
        await this.sendMessage(phoneNumber, 'Sorry, something went wrong while processing your message.');
      } catch {}
    }
  }
}
