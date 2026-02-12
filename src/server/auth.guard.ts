import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const apiKey = this.config.get<string>('server.apiKey', '');
    if (!apiKey) return true; // No key configured = open

    const request = context.switchToHttp().getRequest();
    const headerKey = request.headers['x-api-key'];

    if (headerKey !== apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }
    return true;
  }
}
