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
        releaseUrl="https://github.com/channprj/markdowner/releases/tag/v0.260601.0"
        onViewRelease={vi.fn()}
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

  it('renders the current-version state without an update action', () => {
    const onDismiss = vi.fn();
    render(
      <UpdateBanner
        variant="current"
        latestVersion="0.260601.0"
        releaseUrl="https://github.com/channprj/markdowner/releases/tag/v0.260601.0"
        onViewRelease={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText(/already on the latest version/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View release' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each(['available', 'current'] as const)('opens release notes separately in the %s banner', (variant) => {
    const onViewRelease = vi.fn();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const releaseUrl = 'https://github.com/channprj/markdowner/releases/tag/v0.260601.0';
    render(
      <UpdateBanner
        variant={variant}
        latestVersion="0.260601.0"
        releaseUrl={releaseUrl}
        onViewRelease={onViewRelease}
        actionLabel="Download & Install"
        busy={true}
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    const link = screen.getByRole('link', { name: /release notes.*new window/i });
    expect(link).toHaveAttribute('href', releaseUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(fireEvent.click(link)).toBe(false);
    expect(onViewRelease).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
