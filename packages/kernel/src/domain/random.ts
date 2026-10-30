/** Port for randomness. Inject it instead of calling `Math.random()`. */
export interface Random {
  /** A number in [0, 1). */
  next(): NextRandomResponse;
  /** An integer in [min, max], both inclusive. */
  int(req: IntRandomRequest): IntRandomResponse;
  /** A new random UUID (version 4). */
  uuid(): UuidRandomResponse;
}

export interface UuidRandomResponse {
  value: string;
}

export interface NextRandomResponse {
  value: number;
}

export interface IntRandomRequest {
  min: number;
  max: number;
}

export interface IntRandomResponse {
  value: number;
}

export const RANDOM = Symbol('Random');
