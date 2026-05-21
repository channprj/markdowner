import { describe, expect, it } from 'vitest';

import {
  CLEARED_EXTERNAL_CHANGE_STATE,
  externalChangeDetectedState,
  externalChangeVerificationErrorState,
  formatDiskReadError,
  formatExternalChangeDetected,
  formatExternalChangeVerificationError,
} from './externalChanges';

describe('external change messages', () => {
  it('formats the save-blocking changed-on-disk message', () => {
    expect(formatExternalChangeDetected('meeting-notes.md')).toBe(
      "Could not save 'meeting-notes.md' because it changed on disk.",
    );
  });

  it('formats verification and disk-read failures with the provided reason', () => {
    expect(formatExternalChangeVerificationError('meeting-notes.md', 'permission denied')).toBe(
      "Could not verify external changes for 'meeting-notes.md': permission denied",
    );
    expect(formatDiskReadError('meeting-notes.md', 'file missing')).toBe(
      "Could not read disk version of 'meeting-notes.md': file missing",
    );
  });

  it('uses Untitled.md when there is no active document name', () => {
    expect(formatExternalChangeDetected(null)).toBe(
      "Could not save 'Untitled.md' because it changed on disk.",
    );
    expect(formatExternalChangeVerificationError(undefined, 'failed')).toBe(
      "Could not verify external changes for 'Untitled.md': failed",
    );
    expect(formatDiskReadError(null, 'failed')).toBe(
      "Could not read disk version of 'Untitled.md': failed",
    );
  });
});

describe('external change view state', () => {
  it('describes the cleared external-change UI state', () => {
    expect(CLEARED_EXTERNAL_CHANGE_STATE).toEqual({
      message: null,
      showActions: false,
      compareSource: null,
    });
  });

  it('builds the changed-on-disk state with visible actions', () => {
    expect(externalChangeDetectedState('meeting-notes.md')).toEqual({
      message: "Could not save 'meeting-notes.md' because it changed on disk.",
      showActions: true,
      compareSource: null,
    });
  });

  it('builds the verification-error state without actions', () => {
    expect(
      externalChangeVerificationErrorState('meeting-notes.md', 'permission denied'),
    ).toEqual({
      message: "Could not verify external changes for 'meeting-notes.md': permission denied",
      showActions: false,
      compareSource: null,
    });
  });
});
