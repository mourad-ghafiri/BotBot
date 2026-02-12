import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import { configValidationSchema } from './config.schema';
import { CONFIG_PATH } from '../cli/paths';

function expandEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)(?::([^}]*))?\}/g, (_, name, defaultVal) => {
      return process.env[name] ?? defaultVal ?? '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}

function loadJsonConfig(): Record<string, any> {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}. Run \`bun run src/cli.ts setup\` first.`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, any>;
  const config = expandEnvVars(parsed);

  const { error, value } = configValidationSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
  return value;
}

@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [loadJsonConfig],
      ignoreEnvVars: true,
      isGlobal: true,
    }),
  ],
})
export class AppConfigModule {}
