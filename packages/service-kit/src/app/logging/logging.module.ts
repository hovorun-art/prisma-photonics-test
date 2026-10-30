import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import { multistream } from 'pino';

import type { LogLevel, NodeEnv } from '../../domain/config/base-config.js';
import type { LogDestination } from '../../domain/logging/log-destination.js';
import { LOG_POLICY, type LogFormat, type LogPolicy } from '../../domain/logging/log-policy.js';
import { LogPolicyImpl } from '../../infra/logging/log-policy.impl.js';

export interface LoggingModuleParams {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  /** Fields on every log line (e.g. `instanceId`); pino's own base (pid, hostname) when omitted. */
  base?: Readonly<Record<string, unknown>>;
  /** Where the lines go, always as JSON; standard output when omitted. */
  destination?: LogDestination;
  /**
   * A second destination for the lines at info level and above (the job log); redaction applies
   * to both. The main output (the destination, readable lines in development, or standard output)
   * stays as it is.
   */
  jobLog?: LogDestination;
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
          useFactory: async (policy: LogPolicy): Promise<Params> => {
            const { level, redactedPaths, format } = policy.resolve({
              nodeEnv: p.nodeEnv,
              logLevel: p.logLevel,
            });
            const options = {
              level,
              redact: [...redactedPaths],
              ...(p.base === undefined ? {} : { base: { ...p.base } }),
            };
            if (p.jobLog !== undefined) {
              const main = p.destination ?? (await this.defaultStream(format));
              return {
                pinoHttp: [
                  options,
                  multistream([
                    { level: 'trace', stream: main },
                    { level: 'info', stream: p.jobLog },
                  ]),
                ],
              };
            }
            if (p.destination !== undefined) return { pinoHttp: [options, p.destination] };
            return {
              pinoHttp: {
                ...options,
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

  /** Standard output, or the readable stream of local development. */
  private static async defaultStream(format: LogFormat): Promise<LogDestination> {
    if (format !== 'pretty') return process.stdout;
    const { default: pretty } = await import('pino-pretty');
    return pretty({ singleLine: true });
  }
}
