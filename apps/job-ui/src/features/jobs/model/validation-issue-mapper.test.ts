import { describe, expect, it } from 'vitest';

import { ValidationIssueMapper } from './validation-issue-mapper';

const mapper = new ValidationIssueMapper({ fields: ['payload.url', 'priority'] as const });

describe('ValidationIssueMapper', () => {
  it("maps API issues onto the form's fields with the API's messages", () => {
    const result = mapper.map({
      details: {
        issues: [
          { path: ['payload', 'url'], message: 'Invalid URL' },
          { path: ['priority'], message: 'Too big' },
        ],
      },
    });

    expect(result).toEqual({
      errors: { 'payload.url': 'Invalid URL', priority: 'Too big' },
      unmatched: [],
    });
  });

  it('keeps the first issue of a field', () => {
    const result = mapper.map({
      details: {
        issues: [
          { path: ['payload', 'url'], message: 'Invalid URL' },
          { path: ['payload', 'url'], message: 'Too long' },
        ],
      },
    });

    expect(result.errors).toEqual({ 'payload.url': 'Invalid URL' });
  });

  it('returns issues that match no field as unmatched, so they are not lost', () => {
    const result = mapper.map({
      details: { issues: [{ path: ['type'], message: 'Unknown job type' }] },
    });

    expect(result).toEqual({ errors: {}, unmatched: ['Unknown job type'] });
  });

  it('treats details that are not a list of issues as nothing to map', () => {
    expect(mapper.map({ details: { issues: 'broken' } })).toEqual({ errors: {}, unmatched: [] });
  });
});
