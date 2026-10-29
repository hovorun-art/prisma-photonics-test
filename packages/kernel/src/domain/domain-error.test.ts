import { describe, expect, it } from 'vitest';

import { DomainError } from './domain-error.js';

interface OrderNotFoundErrorParams {
  orderId: string;
}

class OrderNotFoundError extends DomainError<'INTERNAL_UNAUTHORIZED'> {
  constructor(p: OrderNotFoundErrorParams) {
    super({
      code: 'INTERNAL_UNAUTHORIZED',
      message: `Order ${p.orderId} was not found`,
      details: { orderId: p.orderId },
    });
  }
}

class PlainError extends DomainError<'INTERNAL_ERROR'> {
  constructor() {
    super({ code: 'INTERNAL_ERROR', message: 'Something expected went wrong' });
  }
}

// @ts-expect-error a code outside ERROR_CODES must not compile
export class UnknownCodeError extends DomainError<'NOT_A_REGISTERED_CODE'> {}

describe('DomainError', () => {
  it('carries a stable code, a message and structured details', () => {
    const error = new OrderNotFoundError({ orderId: '42' });

    expect(error.code).toBe('INTERNAL_UNAUTHORIZED');
    expect(error.message).toBe('Order 42 was not found');
    expect(error.details).toEqual({ orderId: '42' });
  });

  it('defaults details to an empty object', () => {
    expect(new PlainError().details).toEqual({});
  });

  it('is an Error named after its subclass, so it can be handled by class', () => {
    const error = new OrderNotFoundError({ orderId: '42' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(OrderNotFoundError);
    expect(error.name).toBe('OrderNotFoundError');
    expect(error.stack).toBeDefined();
  });

  it('freezes details so handlers cannot change them', () => {
    const error = new OrderNotFoundError({ orderId: '42' });

    expect(Object.isFrozen(error.details)).toBe(true);
  });
});
