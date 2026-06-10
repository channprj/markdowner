import { describe, expect, it } from 'vitest';

import {
  matchesShortcut,
  resolveEditorFontSizeShortcut,
  resolveFindShortcutAction,
  resolveFocusToggleShortcut,
  resolveModeChord,
  resolveModeNumberShortcut,
  resolveShellShortcutAction,
  resolveTabShortcut,
  resolveTabShortcutAction,
  resolveWordWrapShortcut,
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

describe('resolveFindShortcutAction', () => {
  const context = {
    activeDocumentOpen: true,
    findReplaceOpen: false,
    focusInsideExplorer: false,
    isSidebarOpen: false,
    sidebarPanel: 'files',
  } as const;

  it('closes Find/Replace on unmodified Escape only when it is open', () => {
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'Escape' }), {
        ...context,
        findReplaceOpen: true,
      }),
    ).toEqual({ kind: 'closeFindReplace' });
    expect(resolveFindShortcutAction(shortcutEvent({ key: 'Escape' }), context)).toBeNull();
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'Escape', metaKey: true }), {
        ...context,
        findReplaceOpen: true,
      }),
    ).toBeNull();
  });

  it('opens replace from command-option-f or ctrl-h', () => {
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'f', metaKey: true, altKey: true }), context),
    ).toEqual({ kind: 'openReplace' });
    expect(resolveFindShortcutAction(shortcutEvent({ key: 'h', ctrlKey: true }), context)).toEqual({
      kind: 'openReplace',
    });
  });

  it('routes command-shift-f to search panel focus or sidebar toggle', () => {
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'F', metaKey: true, shiftKey: true }), {
        ...context,
        isSidebarOpen: false,
      }),
    ).toEqual({ kind: 'focusSearchPanel' });
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'f', metaKey: true, shiftKey: true }), {
        ...context,
        isSidebarOpen: true,
        sidebarPanel: 'search',
      }),
    ).toEqual({ kind: 'toggleSidebar' });
  });

  it('routes command-f based on explorer focus and document availability', () => {
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'f', metaKey: true }), {
        ...context,
        focusInsideExplorer: true,
      }),
    ).toEqual({ kind: 'focusExplorerFilter' });
    expect(resolveFindShortcutAction(shortcutEvent({ key: 'f', metaKey: true }), context)).toEqual({
      kind: 'openFind',
    });
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'f', metaKey: true }), {
        ...context,
        activeDocumentOpen: false,
      }),
    ).toEqual({ kind: 'focusSearchPanel' });
  });

  it('ignores unsupported modifier combinations', () => {
    expect(
      resolveFindShortcutAction(
        shortcutEvent({ key: 'f', metaKey: true, altKey: true, shiftKey: true }),
        context,
      ),
    ).toBeNull();
    expect(
      resolveFindShortcutAction(shortcutEvent({ key: 'h', metaKey: true }), context),
    ).toBeNull();
  });
});

describe('resolveShellShortcutAction', () => {
  const context = {
    activeDocumentOpen: true,
    isSidebarOpen: false,
    sidebarPanel: 'files',
  } as const;

  it.each([
    [{ key: 'n', metaKey: true }, { kind: 'newDocument' }],
    [{ key: 't', metaKey: true }, { kind: 'newDocument' }],
    [{ key: 'O', metaKey: true, shiftKey: true }, { kind: 'openWorkspace' }],
    [{ key: 'b', metaKey: true, shiftKey: true }, { kind: 'toggleSidebar' }],
    [{ key: ',', metaKey: true }, { kind: 'toggleSettingsTab' }],
    [{ key: '/', metaKey: true }, { kind: 'toggleShortcuts' }],
    [{ key: 'd', metaKey: true, shiftKey: true }, { kind: 'openOutlinePanel' }],
    [{ key: 'p', metaKey: true, shiftKey: true }, { kind: 'toggleCommandPalette' }],
    [{ key: 'p', metaKey: true }, { kind: 'toggleQuickOpen' }],
    [{ key: 'o', metaKey: true }, { kind: 'openDocument' }],
    [{ key: 's', metaKey: true, shiftKey: true }, { kind: 'saveAs' }],
    [{ key: 's', metaKey: true }, { kind: 'save' }],
    [{ key: 'q', metaKey: true }, { kind: 'quit' }],
    [{ key: 'w', metaKey: true }, { kind: 'closeTabOrWindow' }],
    [{ key: 'Y', metaKey: true, shiftKey: true }, { kind: 'toggleTypewriterMode' }],
    [{ key: 'T', metaKey: true, shiftKey: true }, { kind: 'reopenClosedTab' }],
    [{ key: 'J', metaKey: true, shiftKey: true }, { kind: 'toggleFocusMode' }],
    [{ key: 'm', metaKey: true, shiftKey: true }, { kind: 'toggleTableViewMode' }],
  ] as const)('resolves shell shortcut %o', (event, expected) => {
    expect(resolveShellShortcutAction(shortcutEvent(event), context)).toEqual(expected);
  });

  it('routes Explorer shortcut to show or toggle based on the current sidebar panel', () => {
    expect(
      resolveShellShortcutAction(shortcutEvent({ key: 'e', metaKey: true, shiftKey: true }), {
        ...context,
        isSidebarOpen: false,
        sidebarPanel: 'files',
      }),
    ).toEqual({ kind: 'showExplorerPanel' });

    expect(
      resolveShellShortcutAction(shortcutEvent({ key: 'e', metaKey: true, shiftKey: true }), {
        ...context,
        isSidebarOpen: true,
        sidebarPanel: 'files',
      }),
    ).toEqual({ kind: 'toggleSidebar' });

    expect(
      resolveShellShortcutAction(shortcutEvent({ key: 'e', metaKey: true, shiftKey: true }), {
        ...context,
        isSidebarOpen: true,
        sidebarPanel: 'search',
      }),
    ).toEqual({ kind: 'showExplorerPanel' });
  });

  it('gates document stats on an active document', () => {
    expect(
      resolveShellShortcutAction(shortcutEvent({ key: 'i', metaKey: true, shiftKey: true }), {
        ...context,
        activeDocumentOpen: true,
      }),
    ).toEqual({ kind: 'toggleDocumentStats' });
    expect(
      resolveShellShortcutAction(shortcutEvent({ key: 'i', metaKey: true, shiftKey: true }), {
        ...context,
        activeDocumentOpen: false,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('ignores alt-modified or already-prevented shell shortcuts', () => {
    expect(
      resolveShellShortcutAction(shortcutEvent({ key: 'n', metaKey: true, altKey: true }), context),
    ).toEqual({ kind: 'none' });
    expect(
      resolveShellShortcutAction(
        shortcutEvent({ key: 'n', metaKey: true, defaultPrevented: true }),
        context,
      ),
    ).toEqual({ kind: 'none' });
  });
});

describe('resolveWordWrapShortcut', () => {
  it('matches Option+Z by physical code, ignoring the macOS Ω key value', () => {
    expect(resolveWordWrapShortcut(shortcutEvent({ code: 'KeyZ', key: 'Ω', altKey: true }))).toBe(
      true,
    );
  });

  it('rejects Z without Option and Option+Z carrying extra modifiers', () => {
    expect(resolveWordWrapShortcut(shortcutEvent({ code: 'KeyZ', key: 'z' }))).toBe(false);
    expect(
      resolveWordWrapShortcut(shortcutEvent({ code: 'KeyZ', altKey: true, metaKey: true })),
    ).toBe(false);
    expect(
      resolveWordWrapShortcut(shortcutEvent({ code: 'KeyZ', altKey: true, shiftKey: true })),
    ).toBe(false);
    expect(resolveWordWrapShortcut(shortcutEvent({ code: 'KeyA', altKey: true }))).toBe(false);
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
