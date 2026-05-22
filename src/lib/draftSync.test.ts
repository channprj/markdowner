import { describe, expect, it } from 'vitest';

import {
  resolveActiveDraftSyncPlan,
  resolveAutoSaveEligibility,
  resolveDraftMirrorSyncPlan,
} from './draftSync';

describe('resolveActiveDraftSyncPlan', () => {
  it('does nothing when there is no active document source to sync', () => {
    expect(
      resolveActiveDraftSyncPlan({
        activeDocumentOpen: false,
        activeDocumentSource: '# Saved',
        localDraft: '# Draft',
        flushedDraft: null,
      }),
    ).toBeNull();
    expect(
      resolveActiveDraftSyncPlan({
        activeDocumentOpen: true,
        activeDocumentSource: null,
        localDraft: '# Draft',
        flushedDraft: null,
      }),
    ).toBeNull();
  });

  it('uses a freshly flushed WYSIWYG draft when one is available', () => {
    expect(
      resolveActiveDraftSyncPlan({
        activeDocumentOpen: true,
        activeDocumentSource: '# Saved',
        localDraft: '# Stale local',
        flushedDraft: '# Fresh editor',
      }),
    ).toEqual({
      outgoingDraft: '# Fresh editor',
      shouldReplaceActiveSource: true,
      shouldUpdateLocalDraft: false,
    });
  });

  it('normalizes the draft for final saves and updates local state when normalization changed it', () => {
    expect(
      resolveActiveDraftSyncPlan({
        activeDocumentOpen: true,
        activeDocumentSource: '# Saved\n',
        localDraft: '# Draft\n\n\n',
        flushedDraft: null,
        forFinalSave: true,
      }),
    ).toEqual({
      outgoingDraft: '# Draft\n',
      shouldReplaceActiveSource: true,
      shouldUpdateLocalDraft: true,
    });
  });

  it('skips replacement when only final-newline normalization differs from the saved source', () => {
    expect(
      resolveActiveDraftSyncPlan({
        activeDocumentOpen: true,
        activeDocumentSource: '# Saved\n',
        localDraft: '# Saved\n\n',
        flushedDraft: null,
      }),
    ).toEqual({
      outgoingDraft: '# Saved\n\n',
      shouldReplaceActiveSource: false,
      shouldUpdateLocalDraft: false,
    });
  });
});

describe('resolveAutoSaveEligibility', () => {
  it('schedules when auto-save has a dirty path-backed document and runs only when not busy', () => {
    expect(
      resolveAutoSaveEligibility({
        autoSave: true,
        busy: true,
        activeDocumentOpen: true,
        activeDocumentPath: '/tmp/draft.md',
        hasUnsavedChanges: true,
      }),
    ).toEqual({
      shouldSchedule: true,
      shouldRun: false,
    });

    expect(
      resolveAutoSaveEligibility({
        autoSave: true,
        busy: false,
        activeDocumentOpen: true,
        activeDocumentPath: '/tmp/draft.md',
        hasUnsavedChanges: true,
      }),
    ).toEqual({
      shouldSchedule: true,
      shouldRun: true,
    });
  });

  it('does not schedule for disabled, clean, untitled, or closed documents', () => {
    const base = {
      autoSave: true,
      busy: false,
      activeDocumentOpen: true,
      activeDocumentPath: '/tmp/draft.md',
      hasUnsavedChanges: true,
    };

    expect(resolveAutoSaveEligibility({ ...base, autoSave: false }).shouldSchedule).toBe(
      false,
    );
    expect(
      resolveAutoSaveEligibility({ ...base, activeDocumentOpen: false }).shouldSchedule,
    ).toBe(false);
    expect(
      resolveAutoSaveEligibility({ ...base, activeDocumentPath: null }).shouldSchedule,
    ).toBe(false);
    expect(
      resolveAutoSaveEligibility({ ...base, hasUnsavedChanges: false }).shouldSchedule,
    ).toBe(false);
  });
});

describe('resolveDraftMirrorSyncPlan', () => {
  it('skips mirror sync when there is no active document source or no draft change', () => {
    expect(
      resolveDraftMirrorSyncPlan({
        activeDocumentSource: null,
        activeDocumentPath: '/tmp/draft.md',
        localDraft: '# Draft',
      }),
    ).toBeNull();

    expect(
      resolveDraftMirrorSyncPlan({
        activeDocumentSource: '# Saved',
        activeDocumentPath: '/tmp/draft.md',
        localDraft: '# Saved',
      }),
    ).toBeNull();
  });

  it('returns the draft and active path when the local draft should be mirrored to the backend', () => {
    expect(
      resolveDraftMirrorSyncPlan({
        activeDocumentSource: '# Saved',
        activeDocumentPath: '/tmp/draft.md',
        localDraft: '# Edited',
      }),
    ).toEqual({
      draft: '# Edited',
      activeDocumentPath: '/tmp/draft.md',
    });
  });
});
