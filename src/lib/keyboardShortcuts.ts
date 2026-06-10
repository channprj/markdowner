import type { EditorMode } from './desktop';

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
    return context.isSidebarOpen && context.sidebarPanel === 'search'
      ? { kind: 'toggleSidebar' }
      : { kind: 'focusSearchPanel' };
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
): ShellShortcutAction {
  if (matchesShortcut(event, 'n') || matchesShortcut(event, 't')) {
    return { kind: 'newDocument' };
  }
  if (matchesShortcut(event, 'o', { shift: true })) {
    return { kind: 'openWorkspace' };
  }
  if (matchesShortcut(event, 'e', { shift: true })) {
    return context.isSidebarOpen && context.sidebarPanel === 'files'
      ? { kind: 'toggleSidebar' }
      : { kind: 'showExplorerPanel' };
  }
  if (matchesShortcut(event, 'b', { shift: true })) {
    return { kind: 'toggleSidebar' };
  }
  if (matchesShortcut(event, ',')) {
    return { kind: 'toggleSettingsTab' };
  }
  if (matchesShortcut(event, '/')) {
    return { kind: 'toggleShortcuts' };
  }
  if (matchesShortcut(event, 'd', { shift: true })) {
    return { kind: 'openOutlinePanel' };
  }
  if (matchesShortcut(event, 'p', { shift: true })) {
    return { kind: 'toggleCommandPalette' };
  }
  if (matchesShortcut(event, 'p')) {
    return { kind: 'toggleQuickOpen' };
  }
  if (matchesShortcut(event, 'i', { shift: true })) {
    return context.activeDocumentOpen ? { kind: 'toggleDocumentStats' } : { kind: 'none' };
  }
  if (matchesShortcut(event, 'o')) {
    return { kind: 'openDocument' };
  }
  if (matchesShortcut(event, 's', { shift: true })) {
    return { kind: 'saveAs' };
  }
  if (matchesShortcut(event, 's')) {
    return { kind: 'save' };
  }
  if (matchesShortcut(event, 'q')) {
    return { kind: 'quit' };
  }
  if (matchesShortcut(event, 'w')) {
    return { kind: 'closeTabOrWindow' };
  }
  if (matchesShortcut(event, 't', { shift: true })) {
    return { kind: 'reopenClosedTab' };
  }
  // Cmd+Shift+Y (t-Y-pewriter), leaving Cmd+Shift+T for closed-tab restore.
  if (matchesShortcut(event, 'y', { shift: true })) {
    return { kind: 'toggleTypewriterMode' };
  }
  if (matchesShortcut(event, 'j', { shift: true })) {
    return { kind: 'toggleFocusMode' };
  }
  if (matchesShortcut(event, 'm', { shift: true })) {
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
  if (context.focusInsideExplorer) {
    return { kind: 'focusEditor' };
  }
  return { kind: 'showExplorer' };
}
