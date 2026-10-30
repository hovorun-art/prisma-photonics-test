/**
 * Where a service's log lines go instead of standard output: one JSON line per `write`, in the
 * shape of pino's destination stream (e.g. the e2e tests collect the lines).
 */
export interface LogDestination {
  write(line: string): unknown;
}
