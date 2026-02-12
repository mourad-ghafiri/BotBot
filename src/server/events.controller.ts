import { Controller, Get, Param, Sse, UseGuards, MessageEvent, Req } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Request } from 'express';
import { ApiKeyGuard } from './auth.guard';
import { SseService } from './sse.service';

@Controller('api')
@UseGuards(ApiKeyGuard)
export class EventsController {
  constructor(private readonly sseService: SseService) {}

  @Sse('events/:userId')
  events(@Param('userId') userId: string, @Req() req: Request): Observable<MessageEvent> {
    const stream = this.sseService.getOrCreateStream(userId);

    // Clean up when client disconnects
    req.on('close', () => {
      this.sseService.removeStream(userId);
    });

    return stream.pipe(
      map((event) => ({
        type: event.event,
        data: event.data,
      })),
    );
  }
}
