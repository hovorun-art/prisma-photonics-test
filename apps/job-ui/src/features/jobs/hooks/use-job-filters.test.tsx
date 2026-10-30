import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useJobFilters } from './use-job-filters';

/** The hook together with the router's location and Back, so a test sees the URL it writes. */
function useFiltersAndLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  return {
    ...useJobFilters(),
    url: `${location.pathname}${location.search}`,
    back: () => navigate(-1),
  };
}

function render(path: string) {
  return renderHook(() => useFiltersAndLocation(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    ),
  });
}

describe('useJobFilters', () => {
  it('reads no filters from a URL without parameters', () => {
    const { result } = render('/jobs');

    expect(result.current.filters).toEqual({});
  });

  it('Open a filtered link: reads the status and type from the URL', () => {
    const { result } = render('/jobs?status=failed&type=flight-transit');

    expect(result.current.filters).toEqual({ status: 'failed', type: 'flight-transit' });
  });

  it('Unknown filter value in the URL: treated as All', () => {
    const { result } = render('/jobs?status=unknown&type=batch');

    expect(result.current.filters).toEqual({});
  });

  it('keeps a known filter next to an unknown one', () => {
    const { result } = render('/jobs?status=archived&type=webhook');

    expect(result.current.filters).toEqual({ type: 'webhook' });
  });

  it('Filters in the URL: writes the chosen status and type', () => {
    const { result } = render('/jobs');

    act(() => {
      result.current.setFilters({ status: 'failed', type: 'webhook' });
    });

    expect(result.current.url).toBe('/jobs?status=failed&type=webhook');
    expect(result.current.filters).toEqual({ status: 'failed', type: 'webhook' });
  });

  it('leaves a filter set to All out of the URL', () => {
    const { result } = render('/jobs?status=failed&type=webhook');

    act(() => {
      result.current.setFilters({ type: 'webhook' });
    });

    expect(result.current.url).toBe('/jobs?type=webhook');
  });

  it('Clear filters: removes both parameters', () => {
    const { result } = render('/jobs?status=failed&type=webhook');

    act(() => {
      result.current.setFilters({});
    });

    expect(result.current.url).toBe('/jobs');
    expect(result.current.filters).toEqual({});
  });

  it('Back restores the previous filter: each change is a history step', () => {
    const { result } = render('/jobs');
    act(() => {
      result.current.setFilters({ status: 'failed' });
    });
    act(() => {
      result.current.setFilters({ status: 'completed' });
    });

    act(() => {
      void result.current.back();
    });

    expect(result.current.url).toBe('/jobs?status=failed');
    expect(result.current.filters).toEqual({ status: 'failed' });
  });
});
