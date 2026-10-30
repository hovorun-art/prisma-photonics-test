import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { en } from '@/locales';

import { ComingSoon } from './coming-soon';

describe('ComingSoon', () => {
  it('Disabled filter: the control is disabled and hovering shows "Coming soon"', async () => {
    const user = userEvent.setup();
    render(
      <ComingSoon>
        <button type="button">Failed</button>
      </ComingSoon>,
    );

    expect(screen.getByRole('button', { name: 'Failed' })).toBeDisabled();
    await user.hover(screen.getByRole('button', { name: 'Failed' }).parentElement!);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(en.comingSoon);
  });

  it('Disabled filter: focusing it with the keyboard shows "Coming soon"', async () => {
    const user = userEvent.setup();
    render(
      <ComingSoon>
        <button type="button">Failed</button>
      </ComingSoon>,
    );

    await user.tab();

    expect(await screen.findByRole('tooltip')).toHaveTextContent(en.comingSoon);
  });
});
