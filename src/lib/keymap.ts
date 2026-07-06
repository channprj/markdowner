/**
 * Keymap model for the rebindable application shortcuts.
 *
 * Every rebindable command routes through `resolveShellShortcutAction`
 * (keyboardShortcuts.ts) and always uses the platform command modifier
 * (⌘ on macOS, Ctrl elsewhere) — a binding therefore only stores the key
 * plus the optional Shift/Alt modifiers. Overrides persist in
 * `settings.keybindingOverrides` as `commandId → "mod[+shift][+alt]+<key>"`.
 *
 * Editor-internal shortcuts (CodeMirror/TipTap keymaps, chords, Alt+digit
 * mode switches) are listed as fixed rows so the keymap table is complete
 * and conflicts against them are caught, but they cannot be rebound.
 */

export type KeyBinding = {
  /** Lowercase `event.key` value ('f', '0', '/', ','). */
  key: string;
  shift?: boolean;
  alt?: boolean;
};

export type ShellCommandId =
  | 'file.newDocument'
  | 'file.newTab'
  | 'file.newWindow'
  | 'file.openDocument'
  | 'file.openWorkspace'
  | 'file.save'
  | 'file.saveAs'
  | 'file.closeTabOrWindow'
  | 'file.reopenClosedTab'
  | 'app.quit'
  | 'app.openSettings'
  | 'help.toggleShortcuts'
  | 'view.quickOpen'
  | 'view.commandPalette'
  | 'view.documentStats'
  | 'view.toggleSidebar'
  | 'view.showExplorerPanel'
  | 'view.openOutlinePanel'
  | 'view.typewriterMode'
  | 'view.focusMode'
  | 'view.tableViewMode';

export type ShellBindings = Record<ShellCommandId, KeyBinding>;

export const DEFAULT_SHELL_BINDINGS: ShellBindings = {
  'file.newDocument': { key: 'n' },
  'file.newTab': { key: 't' },
  'file.newWindow': { key: 'n', shift: true },
  'file.openDocument': { key: 'o' },
  'file.openWorkspace': { key: 'o', shift: true },
  'file.save': { key: 's' },
  'file.saveAs': { key: 's', shift: true },
  'file.closeTabOrWindow': { key: 'w' },
  'file.reopenClosedTab': { key: 't', shift: true },
  'app.quit': { key: 'q' },
  'app.openSettings': { key: ',' },
  'help.toggleShortcuts': { key: '/' },
  'view.quickOpen': { key: 'p' },
  'view.commandPalette': { key: 'p', shift: true },
  'view.documentStats': { key: 'i', shift: true },
  'view.toggleSidebar': { key: 'b', shift: true },
  'view.showExplorerPanel': { key: 'e', shift: true },
  'view.openOutlinePanel': { key: 'd', shift: true },
  'view.typewriterMode': { key: 'y', shift: true },
  'view.focusMode': { key: 'j', shift: true },
  'view.tableViewMode': { key: 'm', shift: true },
};

export type KeymapRow = {
  id: string;
  label: string;
  section: string;
  /** Present for rebindable commands. */
  commandId?: ShellCommandId;
  /** Display keys for fixed (non-rebindable) rows. */
  fixedKeys?: string;
  /** Conflict matching for fixed rows that DO use the command modifier. */
  fixedBinding?: KeyBinding;
};

/** Rows shown in the keymap table, grouped by section. */
export const KEYMAP_ROWS: KeymapRow[] = [
  { id: 'file.newDocument', commandId: 'file.newDocument', label: 'New file', section: 'General' },
  { id: 'file.newTab', commandId: 'file.newTab', label: 'New tab', section: 'General' },
  { id: 'file.newWindow', commandId: 'file.newWindow', label: 'New window', section: 'General' },
  { id: 'file.openDocument', commandId: 'file.openDocument', label: 'Open file', section: 'General' },
  { id: 'file.openWorkspace', commandId: 'file.openWorkspace', label: 'Open workspace', section: 'General' },
  { id: 'file.save', commandId: 'file.save', label: 'Save', section: 'General' },
  { id: 'file.saveAs', commandId: 'file.saveAs', label: 'Save As', section: 'General' },
  { id: 'file.closeTabOrWindow', commandId: 'file.closeTabOrWindow', label: 'Close tab', section: 'General' },
  { id: 'file.reopenClosedTab', commandId: 'file.reopenClosedTab', label: 'Reopen closed tab', section: 'General' },
  { id: 'app.quit', commandId: 'app.quit', label: 'Quit', section: 'General' },
  { id: 'app.openSettings', commandId: 'app.openSettings', label: 'Open Settings', section: 'General' },
  { id: 'help.toggleShortcuts', commandId: 'help.toggleShortcuts', label: 'Show keyboard shortcuts', section: 'General' },
  { id: 'view.quickOpen', commandId: 'view.quickOpen', label: 'Quick Open', section: 'Navigation' },
  { id: 'view.commandPalette', commandId: 'view.commandPalette', label: 'Command Palette', section: 'Navigation' },
  { id: 'view.documentStats', commandId: 'view.documentStats', label: 'Document Stats', section: 'Navigation' },
  { id: 'fixed.focusToggle', label: 'Toggle Explorer focus', section: 'Navigation', fixedKeys: '⌘0', fixedBinding: { key: '0' } },
  { id: 'fixed.jumpToTab', label: 'Jump to tab 1–9', section: 'Navigation', fixedKeys: '⌘1 – ⌘9' },
  { id: 'fixed.navigateBack', label: 'Back (previous document)', section: 'Navigation', fixedKeys: '⌘[', fixedBinding: { key: '[' } },
  { id: 'fixed.navigateForward', label: 'Forward (next document)', section: 'Navigation', fixedKeys: '⌘]', fixedBinding: { key: ']' } },
  { id: 'fixed.nextTab', label: 'Next tab', section: 'Navigation', fixedKeys: '⌘⇧]', fixedBinding: { key: ']', shift: true } },
  { id: 'fixed.previousTab', label: 'Previous tab', section: 'Navigation', fixedKeys: '⌘⇧[', fixedBinding: { key: '[', shift: true } },
  { id: 'fixed.moveTabRight', label: 'Move tab right', section: 'Navigation', fixedKeys: '⌃⇧PgDn' },
  { id: 'fixed.moveTabLeft', label: 'Move tab left', section: 'Navigation', fixedKeys: '⌃⇧PgUp' },
  { id: 'fixed.find', label: 'Find in document (or filter Explorer)', section: 'Find & Search', fixedKeys: '⌘F', fixedBinding: { key: 'f' } },
  { id: 'fixed.findReplace', label: 'Find & Replace', section: 'Find & Search', fixedKeys: '⌥⌘F', fixedBinding: { key: 'f', alt: true } },
  { id: 'fixed.workspaceSearch', label: 'Search across workspace', section: 'Find & Search', fixedKeys: '⌘⇧F', fixedBinding: { key: 'f', shift: true } },
  { id: 'fixed.closeFind', label: 'Close find bar', section: 'Find & Search', fixedKeys: 'Esc' },
  { id: 'fixed.modeWysiwyg', label: 'WYSIWYG mode', section: 'Editor Modes', fixedKeys: '⌥1' },
  { id: 'fixed.modeEditor', label: 'Editor mode', section: 'Editor Modes', fixedKeys: '⌥2' },
  { id: 'fixed.modeSplit', label: 'Split View', section: 'Editor Modes', fixedKeys: '⌥3' },
  { id: 'view.typewriterMode', commandId: 'view.typewriterMode', label: 'Toggle Typewriter Mode', section: 'Editor Modes' },
  { id: 'view.focusMode', commandId: 'view.focusMode', label: 'Toggle Focus Mode', section: 'Editor Modes' },
  { id: 'fixed.wordWrap', label: 'Toggle Word Wrap', section: 'Editor Modes', fixedKeys: '⌥Z' },
  { id: 'view.tableViewMode', commandId: 'view.tableViewMode', label: 'Toggle Table View (Normal / Inline)', section: 'Editor Modes' },
  { id: 'fixed.fontSizeUp', label: 'Increase font size', section: 'Editor Modes', fixedKeys: '⌘+' },
  { id: 'fixed.fontSizeDown', label: 'Decrease font size', section: 'Editor Modes', fixedKeys: '⌘-' },
  { id: 'view.toggleSidebar', commandId: 'view.toggleSidebar', label: 'Toggle Sidebar', section: 'Sidebar' },
  { id: 'view.showExplorerPanel', commandId: 'view.showExplorerPanel', label: 'Show Explorer panel', section: 'Sidebar' },
  { id: 'view.openOutlinePanel', commandId: 'view.openOutlinePanel', label: 'Toggle Outline', section: 'Sidebar' },
  { id: 'fixed.turnInto', label: 'Change block format (Turn into)', section: 'Editing (WYSIWYG)', fixedKeys: '⌘/', fixedBinding: { key: '/' } },
  { id: 'fixed.editLink', label: 'Insert or edit link', section: 'Editing (WYSIWYG)', fixedKeys: '⌘K', fixedBinding: { key: 'k' } },
  { id: 'fixed.slashMenu', label: 'Insert block (at line start)', section: 'Editing (WYSIWYG)', fixedKeys: '/' },
];

/**
 * Combos owned by the OS / WebKit that the app must never shadow. Captured
 * candidates matching one of these are rejected with a red warning.
 */
const SYSTEM_RESERVED: Array<{ binding: KeyBinding; label: string }> = [
  { binding: { key: 'c' }, label: 'Copy (system)' },
  { binding: { key: 'v' }, label: 'Paste (system)' },
  { binding: { key: 'x' }, label: 'Cut (system)' },
  { binding: { key: 'a' }, label: 'Select All (system)' },
  { binding: { key: 'z' }, label: 'Undo (system)' },
  { binding: { key: 'z', shift: true }, label: 'Redo (system)' },
  { binding: { key: 'h' }, label: 'Hide Window (macOS)' },
  { binding: { key: 'm' }, label: 'Minimize Window (macOS)' },
  { binding: { key: 'tab' }, label: 'App Switcher (macOS)' },
];

export function bindingsEqual(a: KeyBinding | null, b: KeyBinding | null): boolean {
  if (!a || !b) return false;
  return a.key === b.key && Boolean(a.shift) === Boolean(b.shift) && Boolean(a.alt) === Boolean(b.alt);
}

/** Serialize to the persisted descriptor form: "mod[+shift][+alt]+<key>". */
export function serializeKeyBinding(binding: KeyBinding): string {
  const parts = ['mod'];
  if (binding.shift) parts.push('shift');
  if (binding.alt) parts.push('alt');
  parts.push(binding.key);
  return parts.join('+');
}

export function parseKeyBinding(descriptor: string): KeyBinding | null {
  const parts = descriptor.trim().toLowerCase().split('+');
  if (parts.length < 2 || parts[0] !== 'mod') return null;
  const key = parts[parts.length - 1];
  if (!key || key === 'shift' || key === 'alt' || key === 'mod') return null;
  const modifiers = new Set(parts.slice(1, -1));
  for (const modifier of modifiers) {
    if (modifier !== 'shift' && modifier !== 'alt') return null;
  }
  return {
    key,
    ...(modifiers.has('shift') ? { shift: true } : {}),
    ...(modifiers.has('alt') ? { alt: true } : {}),
  };
}

/**
 * Human-readable macOS-style keys matching the dialog's existing notation:
 * { key:'b', shift:true } → '⌘⇧B'; { key:'f', alt:true } → '⌥⌘F'.
 */
export function formatKeyBinding(binding: KeyBinding): string {
  const key = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  return `${binding.alt ? '⌥' : ''}⌘${binding.shift ? '⇧' : ''}${key}`;
}

/** Effective bindings = defaults overlaid with the persisted overrides. */
export function resolveShellBindings(
  overrides: Record<string, string> | undefined,
): ShellBindings {
  const bindings: ShellBindings = { ...DEFAULT_SHELL_BINDINGS };
  if (!overrides) return bindings;
  for (const [commandId, descriptor] of Object.entries(overrides)) {
    if (!(commandId in bindings)) continue;
    const parsed = parseKeyBinding(descriptor);
    if (parsed) {
      bindings[commandId as ShellCommandId] = parsed;
    }
  }
  return bindings;
}

export type KeymapConflict = {
  kind: 'command' | 'fixed' | 'system';
  label: string;
};

/**
 * Returns the conflict a candidate binding would create for `commandId`,
 * checking the OS-reserved list, fixed app shortcuts, and every OTHER
 * rebindable command's effective binding. Null means safe to save.
 */
export function findKeymapConflict(
  commandId: ShellCommandId,
  candidate: KeyBinding,
  overrides: Record<string, string> | undefined,
): KeymapConflict | null {
  for (const reserved of SYSTEM_RESERVED) {
    if (bindingsEqual(reserved.binding, candidate)) {
      return { kind: 'system', label: reserved.label };
    }
  }
  for (const row of KEYMAP_ROWS) {
    if (row.fixedBinding && bindingsEqual(row.fixedBinding, candidate)) {
      return { kind: 'fixed', label: row.label };
    }
  }
  const effective = resolveShellBindings(overrides);
  for (const row of KEYMAP_ROWS) {
    if (!row.commandId || row.commandId === commandId) continue;
    if (bindingsEqual(effective[row.commandId], candidate)) {
      return { kind: 'command', label: row.label };
    }
  }
  return null;
}

/**
 * Build a KeyBinding from a keydown during recording. Returns null for
 * incomplete chords (bare modifiers) and for events without the command
 * modifier — every rebindable shortcut requires ⌘/Ctrl by design.
 */
export function captureKeyBindingFromEvent(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): KeyBinding | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'meta' || key === 'control' || key === 'shift' || key === 'alt') return null;
  if (key === 'escape' || key === 'enter' || key === 'tab') return null;
  return {
    key,
    ...(event.shiftKey ? { shift: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
  };
}
