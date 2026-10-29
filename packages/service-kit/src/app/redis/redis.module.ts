import { DynamicModule, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';

import { REDIS_CONNECTION, type RedisConnection } from '../../domain/redis/redis-connection.js';
import { IoRedisConnection } from '../../infra/redis/ioredis-connection.js';

export interface RedisModuleParams {
  redisUrl: string;
  /** Name of the connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** The app starts only once Redis has answered; otherwise it connects in the background. */
  awaitFirstAnswer: boolean;
}

/** A service's one Redis connection under `REDIS_CONNECTION`, closed when the app shuts down. */
@Module({})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CONNECTION) private readonly connection: RedisConnection) {}

  static forRoot(p: RedisModuleParams): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS_CONNECTION,
          useFactory: async (): Promise<RedisConnection> => {
            const connection = new IoRedisConnection({ logger: new Logger('Redis') }, p);
            await connection.start();
            return connection;
          },
        },
      ],
      exports: [REDIS_CONNECTION],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
