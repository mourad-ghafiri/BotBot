export interface RedisConnectionOptions {
  host: string;
  port: number;
  db: number;
  password?: string;
}

export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379'),
    db: parseInt(url.pathname?.slice(1) || '0'),
    password: url.password || undefined,
  };
}
