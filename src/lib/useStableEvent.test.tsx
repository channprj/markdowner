import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useStableEvent } from './useStableEvent';

describe('useStableEvent', () => {
  it('keeps one identity across renders and runs the latest closure', () => {
    const { result, rerender } = renderHook(({ value }) => useStableEvent((suffix: string) => `${value}${suffix}`), {
      initialProps: { value: 'first' },
    });
    const initial = result.current;
    rerender({ value: 'second' });
    expect(result.current).toBe(initial);
    expect(initial('!')).toBe('second!');
  });
});
