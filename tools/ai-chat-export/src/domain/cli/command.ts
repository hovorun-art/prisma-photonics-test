/** A command-line entry point. */
export interface Command {
  run(req: RunCommandRequest): Promise<RunCommandResponse>;
}

export interface RunCommandRequest {
  /** The arguments after the script name. */
  args: string[];
}

export interface RunCommandResponse {
  exitCode: number;
}
