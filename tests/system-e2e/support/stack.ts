/** The docker compose stack under test. */
export interface Stack {
  /** Builds the images and starts every service, returning once all are healthy. */
  up(req: UpStackRequest): Promise<UpStackResponse>;
  /** Removes the containers, network and volumes. */
  down(): Promise<DownStackResponse>;
  /** State of the containers of one service. */
  containers(req: ContainersStackRequest): Promise<ContainersStackResponse>;
  /** The log lines of one service, one entry per line, without the compose prefix. */
  logs(req: LogsStackRequest): Promise<LogsStackResponse>;
  /** Stops one service's containers, keeping their data. */
  stop(req: StopStackRequest): Promise<StopStackResponse>;
  /** Starts a stopped service again, returning once it is healthy. */
  start(req: StartStackRequest): Promise<StartStackResponse>;
  /** Kills one container at once (SIGKILL), as a crash would: no shutdown, no reports. */
  kill(req: KillStackRequest): Promise<KillStackResponse>;
  /** Runs a command inside one service's container and returns its output. */
  exec(req: ExecStackRequest): Promise<ExecStackResponse>;
}

export interface UpStackRequest {
  /** Replicas per service that should run more than one. */
  scale: Readonly<Record<string, number>>;
}
export type UpStackResponse = Record<string, never>;

export type DownStackResponse = Record<string, never>;

export interface ContainersStackRequest {
  service: string;
}

export interface StackContainer {
  name: string;
  /** `running`, `exited`, ... */
  state: string;
  /** `healthy`, `unhealthy`, `starting`, or empty when the service has no healthcheck. */
  health: string;
}

export interface ContainersStackResponse {
  containers: StackContainer[];
}

export interface LogsStackRequest {
  service: string;
}

export interface LogsStackResponse {
  lines: string[];
}

export interface StopStackRequest {
  service: string;
}
export type StopStackResponse = Record<string, never>;

export interface StartStackRequest {
  service: string;
}
export type StartStackResponse = Record<string, never>;

export interface KillStackRequest {
  /** The container's name, as `containers` lists it. */
  container: string;
}
export type KillStackResponse = Record<string, never>;

export interface ExecStackRequest {
  service: string;
  command: string[];
}

export interface ExecStackResponse {
  stdout: string;
}
