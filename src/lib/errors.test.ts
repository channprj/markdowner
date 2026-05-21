import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns non-empty Error messages', () => {
    expect(getErrorMessage(new Error('Could not open file'))).toBe('Could not open file');
  });

  it('returns non-empty string errors', () => {
    expect(getErrorMessage(' Could not save file ')).toBe(' Could not save file ');
  });

  it('falls back for empty errors and unknown values', () => {
    expect(getErrorMessage(new Error(''), 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage('   ', 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage(null, 'Fallback message')).toBe('Fallback message');
  });
});
