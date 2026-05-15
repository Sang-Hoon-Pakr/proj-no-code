import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';

const REDIS_IMAGE = 'redis:7-alpine';

export async function startRedis(): Promise<{
  container: StartedRedisContainer;
  client: Redis;
}> {
  const container = await new RedisContainer(REDIS_IMAGE).start();
  const client = new Redis(container.getConnectionUrl());
  return { container, client };
}
