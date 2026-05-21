import { describe, expect, it } from 'vitest';

import {
  matchesShortcut,
  resolveEditorFontSizeShortcut,
  resolveFocusToggleShortcut,
  resolveModeChord,
  resolveModeNumberShortcut,
  resolveTabShortcut,
  resolveTabShortcutAction,
  usesCommandModifier,
} from './keyboardShortcuts';

function shortcutEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: 'x',
    metaKey: false,
    shiftKey: false,
    code: 'KeyX',
    ...overrides,
  } as KeyboardEvent;
}

describe('usesCommandModifier', () => {
  it('accepts either platform command modifier', () => {
    expect(usesCommandModifier(shortcutEvent({ metaKey: true }))).toBe(true);
    expect(usesCommandModifier(shortcutEvent({ ctrlKey: true }))).toBe(true);
    expect(usesCommandModifier(shortcutEvent())).toBe(false);
  });
});

describe('matchesShortcut', () => {
  it('matches command-modified keys case-insensitively', () => {
    expect(matchesShortcut(shortcutEvent({ key: 'F', metaKey: true }), 'f')).toBe(true);
    expect(matchesShortcut(shortcutEvent({ key: 'f', ctrlKey: true }), 'f')).toBe(true);
  });

  it('rejects alt-modified or already-prevented events', () => {
    expect(matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, altKey: true }), 'f')).toBe(
      false,
    );
    expect(
      matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, defaultPrevented: true }), 'f'),
    ).toBe(false);
  });

  it('requires the requested shift state exactly', () => {
    expect(matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, shiftKey: true }), 'f')).toBe(
      false,
    );
    expect(
      matchesShortcut(shortcutEvent({ key: 'f', metaKey: true, shiftKey: true }), 'f', {
        shift: true,
      }),
    ).toBe(true);
  });
});

describe('resolveModeChord', () => {
  it.each([
    ['w', 'Wysiwyg'],
    ['E', 'Editor'],
    ['s', 'SplitView'],
  ] as const)('maps %s to %s mode', (key, mode) => {
    expect(resolveModeChord(shortcutEvent({ key }))).toEqual({ kind: 'mode', mode });
  });

  it('keeps the chord pending while only modifier keys are pressed', () => {
    expect(resolveModeChord(shortcutEvent({ key: 'Meta' }))).toEqual({
      kind: 'pendingModifier',
    });
    expect(resolveModeChord(shortcutEvent({ key: 'Control' }))).toEqual({
      kind: 'pendingModifier',
    });
  });

  it('cancels unknown or shifted chord completions', () => {
    expect(resolveModeChord(shortcutEvent({ key: 'x' }))).toEqual({ kind: 'cancel' });
    expect(resolveModeChord(shortcutEvent({ key: 'w', shiftKey: true }))).toEqual({
      kind: 'cancel',
    });
    expect(resolveModeChord(shortcutEvent({ key: 'w', altKey: true }))).toEqual({
      kind: 'cancel',
    });
  });
});

describe('resolveEditorFontSizeShortcut', () => {
  it.each([
    [{ code: 'Equal', metaKey: true }, 'increase'],
    [{ code: 'Equal', metaKey: true, shiftKey: true }, 'increase'],
    [{ code: 'Minus', ctrlKey: true }, 'decrease'],
  ] as const)('resolves %o as %s', (event, direction) => {
    expect(resolveEditorFontSizeShortcut(shortcutEvent(event))).toEqual({
      kind: direction,
    });
  });

  it('ignores unbound or alt-modified font size key combinations', () => {
    expect(
      resolveEditorFontSizeShortcut(
        shortcutEvent({ code: 'Minus', metaKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      resolveEditorFontSizeShortcut(shortcutEvent({ code: 'Equal', metaKey: true, altKey: true })),
    ).toBeNull();
    expect(resolveEditorFontSizeShortcut(shortcutEvent({ code: 'Equal' }))).toBeNull();
  });
});

describe('resolveTabShortcut', () => {
  it.each([
    [{ key: ']', metaKey: true, shiftKey: true }, { kind: 'selectNext' }],
    [{ key: '}', metaKey: true, shiftKey: true }, { kind: 'selectNext' }],
    [{ key: '[', ctrlKey: true, shiftKey: true }, { kind: 'selectPrevious' }],
    [{ key: '{', ctrlKey: true, shiftKey: true }, { kind: 'selectPrevious' }],
  ] as const)('resolves tab selection shortcut %o', (event, expected) => {
    expect(resolveTabShortcut(shortcutEvent(event))).toEqual(expected);
  });

  it.each([
    ['1', 0],
    ['9', 8],
  ] as const)('resolves command+%s to a tab index', (key, index) => {
    expect(resolveTabShortcut(shortcutEvent({ key, metaKey: true }))).toEqual({
      kind: 'selectIndex',
      index,
    });
  });

  it.each([
    [{ key: 'PageUp', ctrlKey: true, shiftKey: true }, -1],
    [{ key: 'PageDown', ctrlKey: true, shiftKey: true }, 1],
  ] as const)('resolves move-tab shortcut %o', (event, direction) => {
    expect(resolveTabShortcut(shortcutEvent(event))).toEqual({
      kind: 'moveActive',
      direction,
    });
  });

  it('ignores tab shortcuts with unsupported modifiers or keys', () => {
    expect(resolveTabShortcut(shortcutEvent({ key: ']', metaKey: true }))).toBeNull();
    expect(
      resolveTabShortcut(shortcutEvent({ key: '1', metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      resolveTabShortcut(
        shortcutEvent({
          key: 'PageDown',
          ctrlKey: true,
          shiftKey: true,
          metaKey: true,
        }),
      ),
    ).toBeNull();
    expect(resolveTabShortcut(shortcutEvent({ key: '0', metaKey: true }))).toBeNull();
  });
});

describe('resolveTabShortcutAction', () => {
  const tabs = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];

  it('selects a tab index and requests editor focus when the tab exists', () => {
    expect(
      resolveTabShortcutAction({
        shortcut: { kind: 'selectIndex', index: 1 },
        tabs,
        activeTabId: 'one',
      }),
    ).toEqual({ kind: 'selectTab', targetId: 'two', focusEditor: true });
  });

  it('returns no action for a missing tab index', () => {
    expect(
      resolveTabShortcutAction({
        shortcut: { kind: 'selectIndex', index: 8 },
        tabs,
        activeTabId: 'one',
      }),
    ).toEqual({ kind: 'none' });
  });

  it('wraps next and previous tab selection around the open tab list', () => {
    expect(
      resolveTabShortcutAction({
        shortcut: { kind: 'selectNext' },
        tabs,
        activeTabId: 'three',
      }),
    ).toEqual({ kind: 'selectTab', targetId: 'one', focusEditor: false });

    expect(
      resolveTabShortcutAction({
        shortcut: { kind: 'selectPrevious' },
        tabs,
        activeTabId: 'one',
      }),
    ).toEqual({ kind: 'selectTab', targetId: 'three', focusEditor: false });
  });

  it('moves the active tab only when an active tab exists', () => {
    expect(
      resolveTabShortcutAction({
        shortcut: { kind: 'moveActive', direction: 1 },
        tabs,
        activeTabId: 'one',
      }),
    ).toEqual({ kind: 'moveActive', direction: 1 });

    expect(
      resolveTabShortcutAction({
        shortcut: { kind: 'moveActive', direction: 1 },
        tabs,
        activeTabId: null,
      }),
    ).toEqual({ kind: 'none' });
  });
});

describe('resolveModeNumberShortcut', () => {
  it.each([
    ['Digit1', 'Wysiwyg'],
    ['Digit2', 'Editor'],
    ['Digit3', 'SplitView'],
  ] as const)('maps Alt+%s to %s mode', (code, mode) => {
    expect(resolveModeNumberShortcut(shortcutEvent({ code, altKey: true }))).toEqual({
      kind: 'mode',
      mode,
    });
  });

  it('ignores unsupported mode number shortcuts', () => {
    expect(resolveModeNumberShortcut(shortcutEvent({ code: 'Digit4', altKey: true }))).toBeNull();
    expect(
      resolveModeNumberShortcut(shortcutEvent({ code: 'Digit1', altKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      resolveModeNumberShortcut(shortcutEvent({ code: 'Digit1', altKey: true, metaKey: true })),
    ).toBeNull();
    expect(resolveModeNumberShortcut(shortcutEvent({ code: 'Digit1' }))).toBeNull();
  });
});

describe('resolveFocusToggleShortcut', () => {
  it('returns null for keys other than command+0', () => {
    expect(
      resolveFocusToggleShortcut(shortcutEvent({ key: '0' }), {
        isSidebarOpen: false,
        sidebarPanel: 'files',
        focusInsideExplorer: false,
      }),
    ).toBeNull();
    expect(
      resolveFocusToggleShortcut(shortcutEvent({ key: '1', metaKey: true }), {
        isSidebarOpen: false,
        sidebarPanel: 'files',
        focusInsideExplorer: false,
      }),
    ).toBeNull();
  });

  it('focuses Outline when the Outline panel is already visible', () => {
    expect(
      resolveFocusToggleShortcut(shortcutEvent({ key: '0', metaKey: true }), {
        isSidebarOpen: true,
        sidebarPanel: 'outline',
        focusInsideExplorer: false,
      }),
    ).toEqual({ kind: 'focusOutline' });
  });

  it('returns focusEditor when focus starts inside the Explorer', () => {
    expect(
      resolveFocusToggleShortcut(shortcutEvent({ key: '0', ctrlKey: true }), {
        isSidebarOpen: true,
        sidebarPanel: 'files',
        focusInsideExplorer: true,
      }),
    ).toEqual({ kind: 'focusEditor' });
  });

  it('shows Explorer and focuses the tree otherwise', () => {
    expect(
      resolveFocusToggleShortcut(shortcutEvent({ key: '0', metaKey: true }), {
        isSidebarOpen: false,
        sidebarPanel: 'search',
        focusInsideExplorer: false,
      }),
    ).toEqual({ kind: 'showExplorer' });
  });
});
