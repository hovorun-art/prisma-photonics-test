import { DynamicModule, Global, Module } from '@nestjs/common';

export interface ServiceConfigModuleParams<TConfig> {
  /** The app's DI token for its config (e.g. `JOB_SERVICE_CONFIG`). */
  token: symbol;
  /** Validated once at startup, before the app is built. */
  config: TConfig;
}

/** Makes a service's validated configuration injectable everywhere under the app's own token. */
@Global()
@Module({})
export class ServiceConfigModule {
  static forRoot<TConfig>(p: ServiceConfigModuleParams<TConfig>): DynamicModule {
    return {
      module: ServiceConfigModule,
      providers: [{ provide: p.token, useValue: p.config }],
      exports: [p.token],
    };
  }
}
