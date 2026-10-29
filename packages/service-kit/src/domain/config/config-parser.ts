/** Reads a service's configuration from the environment once, at startup. */
export interface ConfigParser<TConfig> {
  /** Never throws: an invalid environment is a result with `problems`. */
  parse(req: ParseConfigParserRequest): ParseConfigParserResponse<TConfig>;
}

export interface ParseConfigParserRequest {
  env: Readonly<Record<string, string | undefined>>;
}

/** `problems` names every missing or invalid variable, never a secret value. */
export type ParseConfigParserResponse<TConfig> =
  { ok: true; config: TConfig } | { ok: false; problems: string };
