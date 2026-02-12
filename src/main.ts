import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors();
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const serverCfg = config.get('server');

  if (process.env.BOTBOT_WORKER_MODE) {
    await app.init();
    logger.log('BotBot worker started (tool jobs only)');
  } else if (serverCfg.enabled) {
    await app.listen(serverCfg.port, serverCfg.ip);
    logger.log(`BotBot API server listening on ${serverCfg.ip}:${serverCfg.port}`);
  } else {
    await app.init();
    logger.log('BotBot started (no HTTP server)');
  }
}

if (require.main === module) {
  bootstrap();
}
