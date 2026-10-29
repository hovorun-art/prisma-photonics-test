import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';

import type { LogLevel, NodeEnv } from '../../domain/config/base-config.js';
import { LOG_POLICY, type LogPolicy } from '../../domain/logging/log-policy.js';
import { LogPolicyImpl } from '../../infra/logging/log-policy.impl.js';

export interface LoggingModuleParams {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  /** Fields on every log line (e.g. `instanceId`); pino's own base (pid, hostname) when omitted. */
  base?: Readonly<Record<string, unknown>>;
}

/** Structured logging with pino: JSON lines, request logs with credentials redacted. */
@Module({})
export class LoggingModule {
  static forRoot(p: LoggingModuleParams): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRootAsync({
          providers: [{ provide: LOG_POLICY, useFactory: () => new LogPolicyImpl() }],
          useFactory: (policy: LogPolicy): Params => {
            const { level, redactedPaths, format } = policy.resolve({
              nodeEnv: p.nodeEnv,
              logLevel: p.logLevel,
            });
            return {
              pinoHttp: {
                level,
                redact: [...redactedPaths],
                ...(p.base === undefined ? {} : { base: { ...p.base } }),
                ...(format === 'pretty'
                  ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
                  : {}),
              },
            };
          },
          inject: [LOG_POLICY],
        }),
      ],
    };
  }
}
