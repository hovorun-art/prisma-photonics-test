/** Something that can be shut down: an application, a server, a connection pool. */
export interface Closable {
  close(): Promise<CloseClosableResponse>;
}

export type CloseClosableResponse = Record<string, never>;
