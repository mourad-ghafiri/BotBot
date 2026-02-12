import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface SseEvent {
  event: string;
  data: any;
}

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly streams = new Map<string, Subject<SseEvent>>();

  getOrCreateStream(userId: string): Observable<SseEvent> {
    if (!this.streams.has(userId)) {
      this.streams.set(userId, new Subject<SseEvent>());
    }
    return this.streams.get(userId)!.asObservable();
  }

  pushEvent(userId: string, event: string, data: any): void {
    const stream = this.streams.get(userId);
    if (stream) {
      stream.next({ event, data });
    }
  }

  pushToAll(event: string, data: any): void {
    for (const [userId, stream] of this.streams) {
      stream.next({ event, data });
    }
  }

  removeStream(userId: string): void {
    const stream = this.streams.get(userId);
    if (stream) {
      stream.complete();
      this.streams.delete(userId);
    }
  }

  hasConnectedUser(userId: string): boolean {
    return this.streams.has(userId);
  }
}
