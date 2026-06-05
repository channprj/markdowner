import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdateBanner } from './UpdateBanner';

describe('UpdateBanner', () => {
  afterEach(() => cleanup());

  it('renders the latest version and fires the action + dismiss handlers', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UpdateBanner
        latestVersion="0.260601.0"
        actionLabel="View release"
        busy={false}
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/0\.260601\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View release' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
