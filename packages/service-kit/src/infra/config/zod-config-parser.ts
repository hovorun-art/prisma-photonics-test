import { z } from 'zod';

import type {
  ConfigParser,
  ParseConfigParserRequest,
  ParseConfigParserResponse,
} from '../../domain/config/config-parser.js';

export interface ZodConfigParserParams<TConfig> {
  /** The app's environment schema: the base one extended with its own fields, transformed to config. */
  schema: z.ZodType<TConfig>;
}

/** Validates the environment with a Zod schema; problems are listed by variable name. */
export class ZodConfigParser<TConfig> implements ConfigParser<TConfig> {
  constructor(private readonly p: ZodConfigParserParams<TConfig>) {}

  parse(req: ParseConfigParserRequest): ParseConfigParserResponse<TConfig> {
    const result = this.p.schema.safeParse(req.env);
    return result.success
      ? { ok: true, config: result.data }
      : { ok: false, problems: z.prettifyError(result.error) };
  }
}
