import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodConfigParser } from './zod-config-parser.js';

describe('ZodConfigParser', () => {
  const parser = new ZodConfigParser({
    schema: z
      .object({ PORT: z.coerce.number().int(), TOKEN: z.string().min(1) })
      .transform((env) => ({ port: env.PORT, token: env.TOKEN })),
  });

  it('returns the transformed config of a valid environment', () => {
    expect(parser.parse({ env: { PORT: '3000', TOKEN: 'abc' } })).toEqual({
      ok: true,
      config: { port: 3000, token: 'abc' },
    });
  });

  it('names every missing or invalid variable and never throws', () => {
    const result = parser.parse({ env: { PORT: 'many' } });

    expect(result.ok).toBe(false);
    const problems = result.ok ? '' : result.problems;
    expect(problems).toContain('PORT');
    expect(problems).toContain('TOKEN');
  });
});
