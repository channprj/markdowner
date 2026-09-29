import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Switch } from './switch';

afterEach(cleanup);

describe('Switch', () => {
  it.each([false, true])('keeps the button ref attached until unmount (cleanup ref: %s)', (withCleanup) => {
    const detach = vi.fn();
    const ref = vi.fn(() => withCleanup ? detach : undefined);
    const { rerender, unmount } = render(<Switch ref={ref} checked={false} aria-label="Auto save" />);
    const button = screen.getByRole('switch', { name: 'Auto save' });
    ref.mockClear();

    rerender(<Switch ref={ref} checked aria-label="Auto save" />);

    expect(button).toHaveAttribute('aria-checked', 'true');
    expect(ref).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();

    unmount();
    if (withCleanup) {
      expect(detach).toHaveBeenCalledOnce();
      expect(ref).not.toHaveBeenCalled();
    } else {
      expect(ref).toHaveBeenCalledExactlyOnceWith(null);
    }
  });

  it('toggles a controlled setting in StrictMode without an update loop', () => {
    function Setting() {
      const [checked, setChecked] = useState(false);
      return <Switch checked={checked} onCheckedChange={setChecked} aria-label="Auto save" />;
    }

    render(<StrictMode><Setting /></StrictMode>);
    const button = screen.getByRole('switch', { name: 'Auto save' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-checked', 'false');
  });
});
