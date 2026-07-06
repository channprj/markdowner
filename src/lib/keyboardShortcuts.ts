import type { EditorMode } from './desktop';
import {
  DEFAULT_SHELL_BINDINGS,
  type KeyBinding,
  type ShellBindings,
  type ShellCommandId,
} from './keymap';

type CommandModifierEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;

type ShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'defaultPrevented' | 'key' | 'shiftKey'>;

type ModeChordEvent = Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type EditorFontSizeShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'code' | 'shiftKey'>;

type FindShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type TabShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type ModeNumberShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'code' | 'shiftKey'>;

type FocusToggleShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'key' | 'shiftKey'>;

type FocusToggleContext = {
  isSidebarOpen: boolean;
  sidebarPanel: 'files' | 'outline' | 'search';
  focusInsideExplorer: boolean;
  focusInsideSearch: boolean;
};

type FindShortcutContext = {
  activeDocumentOpen: boolean;
  findReplaceOpen: boolean;
  focusInsideExplorer: boolean;
  isSidebarOpen: boolean;
  sidebarPanel: 'files' | 'outline' | 'search';
};

type ShellShortcutContext = {
  activeDocumentOpen: boolean;
  isSidebarOpen: boolean;
  sidebarPanel: 'files' | 'outline' | 'search';
};

export type ModeChordResolution =
  | { kind: 'pendingModifier' }
  | { kind: 'mode'; mode: EditorMode }
  | { kind: 'cancel' };

export type EditorFontSizeShortcutResolution = { kind: 'increase' } | { kind: 'decrease' };

export type FindShortcutAction =
  | { kind: 'closeFindReplace' }
  | { kind: 'focusExplorerFilter' }
  | { kind: 'focusSearchPanel' }
  | { kind: 'openFind' }
  | { kind: 'openReplace' }
  | { kind: 'toggleSidebar' };

export type ShellShortcutAction =
  | { kind: 'closeTabOrWindow' }
  | { kind: 'newDocument' }
  | { kind: 'newWindow' }
  | { kind: 'none' }
  | { kind: 'openDocument' }
  | { kind: 'openOutlinePanel' }
  | { kind: 'openWorkspace' }
  | { kind: 'quit' }
  | { kind: 'reopenClosedTab' }
  | { kind: 'save' }
  | { kind: 'saveAs' }
  | { kind: 'showExplorerPanel' }
  | { kind: 'toggleCommandPalette' }
  | { kind: 'toggleDocumentStats' }
  | { kind: 'toggleFocusMode' }
  | { kind: 'toggleQuickOpen' }
  | { kind: 'toggleSettingsTab' }
  | { kind: 'toggleShortcuts' }
  | { kind: 'toggleSidebar' }
  | { kind: 'toggleTableViewMode' }
  | { kind: 'toggleTypewriterMode' };

export type TabShortcutResolution =
  | { kind: 'selectNext' }
  | { kind: 'selectPrevious' }
  | { kind: 'selectIndex'; index: number }
  | { kind: 'moveActive'; direction: -1 | 1 };

type TabShortcutActionInput = {
  shortcut: TabShortcutResolution;
  tabs: ReadonlyArray<{ id: string }>;
  activeTabId: string | null;
};

export type TabShortcutAction =
  | { kind: 'selectTab'; targetId: string; focusEditor: boolean }
  | { kind: 'moveActive'; direction: -1 | 1 }
  | { kind: 'none' };

export type ModeNumberShortcutResolution = { kind: 'mode'; mode: EditorMode };

export type FocusToggleShortcutResolution =
  | { kind: 'focusOutline' }
  | { kind: 'focusEditor' }
  | { kind: 'showExplorer' };

export function usesCommandModifier(event: CommandModifierEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function matchesShortcut(
  event: ShortcutEvent,
  key: string,
  options: { shift?: boolean } = {},
): boolean {
  if (event.defaultPrevented || event.altKey || !usesCommandModifier(event)) {
    return false;
  }

  return event.key.toLowerCase() === key && event.shiftKey === (options.shift ?? false);
}

/** Like `matchesShortcut`, but driven by a (possibly user-overridden) binding. */
function matchesBinding(event: ShortcutEvent, binding: KeyBinding): boolean {
  if (event.defaultPrevented || !usesCommandModifier(event)) {
    return false;
  }
  return (
    event.key.toLowerCase() === binding.key &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt)
  );
}

export function resolveModeChord(event: ModeChordEvent): ModeChordResolution {
  const key = event.key.toLowerCase();
  if (key === 'meta' || key === 'control' || key === 'shift' || key === 'alt') {
    return { kind: 'pendingModifier' };
  }
  if (event.altKey || event.shiftKey) {
    return { kind: 'cancel' };
  }

  switch (key) {
    case 'w':
      return { kind: 'mode', mode: 'Wysiwyg' };
    case 'e':
      return { kind: 'mode', mode: 'Editor' };
    case 's':
      return { kind: 'mode', mode: 'SplitView' };
    default:
      return { kind: 'cancel' };
  }
}

export function resolveEditorFontSizeShortcut(
  event: EditorFontSizeShortcutEvent,
): EditorFontSizeShortcutResolution | null {
  if (!usesCommandModifier(event) || event.altKey) {
    return null;
  }
  if (event.code === 'Equal') {
    return { kind: 'increase' };
  }
  if (event.code === 'Minus' && !event.shiftKey) {
    return { kind: 'decrease' };
  }
  return null;
}

export function resolveFindShortcutAction(
  event: FindShortcutEvent,
  context: FindShortcutContext,
): FindShortcutAction | null {
  const key = event.key.toLowerCase();
  const hasCommandModifier = usesCommandModifier(event);

  if (
    key === 'escape' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    context.findReplaceOpen
  ) {
    return { kind: 'closeFindReplace' };
  }

  if (hasCommandModifier && event.altKey && !event.shiftKey && key === 'f') {
    return { kind: 'openReplace' };
  }

  if (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    key === 'h'
  ) {
    return { kind: 'openReplace' };
  }

  if (hasCommandModifier && !event.altKey && event.shiftKey && key === 'f') {
    // Always land in the workspace search input — pressing the shortcut
    // again while the panel is already open re-focuses the query (VS Code
    // behaviour) instead of closing the sidebar.
    return { kind: 'focusSearchPanel' };
  }

  if (hasCommandModifier && !event.altKey && !event.shiftKey && key === 'f') {
    if (context.focusInsideExplorer) {
      return { kind: 'focusExplorerFilter' };
    }
    return context.activeDocumentOpen ? { kind: 'openFind' } : { kind: 'focusSearchPanel' };
  }

  return null;
}

export function resolveShellShortcutAction(
  event: ShortcutEvent,
  context: ShellShortcutContext,
  bindings: ShellBindings = DEFAULT_SHELL_BINDINGS,
): ShellShortcutAction {
  const matches = (commandId: ShellCommandId) => matchesBinding(event, bindings[commandId]);

  if (matches('file.newDocument') || matches('file.newTab')) {
    return { kind: 'newDocument' };
  }
  if (matches('file.newWindow')) {
    return { kind: 'newWindow' };
  }
  if (matches('file.openWorkspace')) {
    return { kind: 'openWorkspace' };
  }
  if (matches('view.showExplorerPanel')) {
    return context.isSidebarOpen && context.sidebarPanel === 'files'
      ? { kind: 'toggleSidebar' }
      : { kind: 'showExplorerPanel' };
  }
  if (matches('view.toggleSidebar')) {
    return { kind: 'toggleSidebar' };
  }
  if (matches('app.openSettings')) {
    return { kind: 'toggleSettingsTab' };
  }
  if (matches('help.toggleShortcuts')) {
    return { kind: 'toggleShortcuts' };
  }
  if (matches('view.openOutlinePanel')) {
    return { kind: 'openOutlinePanel' };
  }
  if (matches('view.commandPalette')) {
    return { kind: 'toggleCommandPalette' };
  }
  if (matches('view.quickOpen')) {
    return { kind: 'toggleQuickOpen' };
  }
  if (matches('view.documentStats')) {
    return context.activeDocumentOpen ? { kind: 'toggleDocumentStats' } : { kind: 'none' };
  }
  if (matches('file.openDocument')) {
    return { kind: 'openDocument' };
  }
  if (matches('file.saveAs')) {
    return { kind: 'saveAs' };
  }
  if (matches('file.save')) {
    return { kind: 'save' };
  }
  if (matches('app.quit')) {
    return { kind: 'quit' };
  }
  if (matches('file.closeTabOrWindow')) {
    return { kind: 'closeTabOrWindow' };
  }
  if (matches('file.reopenClosedTab')) {
    return { kind: 'reopenClosedTab' };
  }
  // Cmd+Shift+Y (t-Y-pewriter) by default, leaving Cmd+Shift+T for
  // closed-tab restore.
  if (matches('view.typewriterMode')) {
    return { kind: 'toggleTypewriterMode' };
  }
  if (matches('view.focusMode')) {
    return { kind: 'toggleFocusMode' };
  }
  if (matches('view.tableViewMode')) {
    return { kind: 'toggleTableViewMode' };
  }
  return { kind: 'none' };
}

type WordWrapShortcutEvent = CommandModifierEvent &
  Pick<KeyboardEvent, 'altKey' | 'code' | 'shiftKey'>;

/**
 * Toggle Word Wrap with Option+Z (VS Code convention). Keyed on `event.code`
 * rather than `event.key` because macOS reports `Ω` for Option+Z; the caller
 * must `preventDefault()` so that character is never inserted into the editor.
 */
export function resolveWordWrapShortcut(event: WordWrapShortcutEvent): boolean {
  return (
    event.code === 'KeyZ' &&
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

export function resolveTabShortcut(event: TabShortcutEvent): TabShortcutResolution | null {
  if (usesCommandModifier(event) && event.shiftKey && !event.altKey) {
    if (event.key === ']' || event.key === '}') {
      return { kind: 'selectNext' };
    }
    if (event.key === '[' || event.key === '{') {
      return { kind: 'selectPrevious' };
    }
  }

  if (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === 'PageUp' || event.key === 'PageDown')
  ) {
    return {
      kind: 'moveActive',
      direction: event.key === 'PageDown' ? 1 : -1,
    };
  }

  if (
    event.key.length === 1 &&
    /[1-9]/.test(event.key) &&
    usesCommandModifier(event) &&
    !event.shiftKey &&
    !event.altKey
  ) {
    return {
      kind: 'selectIndex',
      index: Number.parseInt(event.key, 10) - 1,
    };
  }

  return null;
}

/**
 * ⌘[ / ⌘] (no Shift) → Back / Forward through the document visit trail, mirroring
 * Chrome's macOS navigation keys. The Shift variants (⌘⇧[ / ⌘⇧]) belong to
 * previous/next tab, so this requires Shift to be UP.
 */
export function resolveHistoryNavShortcut(event: TabShortcutEvent): 'back' | 'forward' | null {
  if (!usesCommandModifier(event) || event.shiftKey || event.altKey) {
    return null;
  }
  if (event.key === '[') return 'back';
  if (event.key === ']') return 'forward';
  return null;
}

export function resolveTabShortcutAction({
  shortcut,
  tabs,
  activeTabId,
}: TabShortcutActionInput): TabShortcutAction {
  if (shortcut.kind === 'selectIndex') {
    const target = tabs[shortcut.index];
    return target
      ? { kind: 'selectTab', targetId: target.id, focusEditor: true }
      : { kind: 'none' };
  }

  if (shortcut.kind === 'moveActive') {
    return tabs.length > 0 && activeTabId
      ? { kind: 'moveActive', direction: shortcut.direction }
      : { kind: 'none' };
  }

  if (!activeTabId || tabs.length === 0) {
    return { kind: 'none' };
  }

  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  if (index < 0) {
    return { kind: 'none' };
  }

  const offset = shortcut.kind === 'selectNext' ? 1 : -1;
  const target = tabs[(index + offset + tabs.length) % tabs.length];
  if (!target || target.id === activeTabId) {
    return { kind: 'none' };
  }

  return { kind: 'selectTab', targetId: target.id, focusEditor: false };
}

export function resolveModeNumberShortcut(
  event: ModeNumberShortcutEvent,
): ModeNumberShortcutResolution | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }

  switch (event.code) {
    case 'Digit1':
      return { kind: 'mode', mode: 'Wysiwyg' };
    case 'Digit2':
      return { kind: 'mode', mode: 'Editor' };
    case 'Digit3':
      return { kind: 'mode', mode: 'SplitView' };
    default:
      return null;
  }
}

export function resolveFocusToggleShortcut(
  event: FocusToggleShortcutEvent,
  context: FocusToggleContext,
): FocusToggleShortcutResolution | null {
  if (event.key !== '0' || !usesCommandModifier(event) || event.shiftKey || event.altKey) {
    return null;
  }
  if (context.isSidebarOpen && context.sidebarPanel === 'outline') {
    return { kind: 'focusOutline' };
  }
  // From either sidebar focus surface (explorer tree or the workspace
  // search panel) Cmd+0 returns to the editor, whose own selection is the
  // remembered cursor position.
  if (context.focusInsideExplorer || context.focusInsideSearch) {
    return { kind: 'focusEditor' };
  }
  return { kind: 'showExplorer' };
}
