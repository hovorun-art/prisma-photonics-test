import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { en } from '@/locales';

import { AppShell } from './app-shell';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppShell', () => {
  it('UI started: shows the application name and the started message', () => {
    render(<AppShell />);

    expect(screen.getByRole('heading', { name: en.appShell.name })).toBeVisible();
    expect(screen.getByText(en.appShell.started)).toBeVisible();
  });

  it('Backend not needed: makes no request to the backend', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<AppShell />);

    expect(screen.getByText(en.appShell.started)).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
