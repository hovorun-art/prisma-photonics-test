// Shared setup of the job-ui unit tests: DOM matchers, a fixed time zone and a clean DOM per test.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

process.env.TZ = 'UTC';

/** jsdom has no ResizeObserver; Radix positions tooltips with it. Tests never resize anything. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {
    // Nothing is ever resized in jsdom.
  }
  unobserve(): void {
    // Nothing to stop.
  }
  disconnect(): void {
    // Nothing to stop.
  }
}
globalThis.ResizeObserver = NoopResizeObserver;

/** jsdom does not scroll; `cmdk` scrolls the highlighted option into view. */
Element.prototype.scrollIntoView = () => {
  // Nothing to scroll in jsdom.
};

/** jsdom has no blob URLs; tests that download something spy on these and answer once. */
URL.createObjectURL = () => {
  throw new Error('jsdom has no blob URLs; stub URL.createObjectURL in the test');
};
URL.revokeObjectURL = () => {
  // Nothing to free in jsdom.
};

afterEach(() => {
  cleanup();
});
