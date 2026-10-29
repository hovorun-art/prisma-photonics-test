/** Counts the connections a client has open to Postgres under an application name. */
export interface PostgresConnectionCounter {
  count(
    req: CountPostgresConnectionCounterRequest,
  ): Promise<CountPostgresConnectionCounterResponse>;
}

export interface CountPostgresConnectionCounterRequest {
  /** The connection's `application_name`. */
  name: string;
}

export interface CountPostgresConnectionCounterResponse {
  connections: number;
}
