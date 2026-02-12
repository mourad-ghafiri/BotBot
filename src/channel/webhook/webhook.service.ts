import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly callbackUrl: string;
  private readonly secret: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<boolean>('channel.webhook.enabled', false);
    this.callbackUrl = this.config.get<string>('channel.webhook.callback_url', '');
    this.secret = this.config.get<string>('channel.webhook.secret', '');
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    await this.post({ userId, type: 'message', text });
  }

  async sendNotification(userId: string, title: string, body: string): Promise<void> {
    await this.post({ userId, type: 'notification', title, body });
  }

  async sendFile(userId: string, filePath: string): Promise<void> {
    await this.post({ userId, type: 'file', filePath });
  }

  private async post(payload: Record<string, any>): Promise<void> {
    if (!this.enabled || !this.callbackUrl) return;

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.secret) {
      const signature = crypto.createHmac('sha256', this.secret).update(body).digest('hex');
      headers['X-Signature'] = signature;
    }

    try {
      const res = await fetch(this.callbackUrl, { method: 'POST', headers, body });
      if (!res.ok) {
        this.logger.warn(`Webhook POST failed (${res.status}): ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`Webhook POST error: ${err}`);
    }
  }
}
