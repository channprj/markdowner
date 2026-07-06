import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHELL_BINDINGS,
  KEYMAP_ROWS,
  bindingsEqual,
  captureKeyBindingFromEvent,
  findKeymapConflict,
  formatKeyBinding,
  parseKeyBinding,
  resolveShellBindings,
  serializeKeyBinding,
} from './keymap';

describe('keymap descriptors', () => {
  it('round-trips bindings through serialize/parse', () => {
    for (const binding of Object.values(DEFAULT_SHELL_BINDINGS)) {
      expect(parseKeyBinding(serializeKeyBinding(binding))).toEqual(binding);
    }
  });

  it('rejects malformed descriptors', () => {
    expect(parseKeyBinding('shift+f')).toBeNull();
    expect(parseKeyBinding('mod+')).toBeNull();
    expect(parseKeyBinding('mod+meta+f')).toBeNull();
    expect(parseKeyBinding('mod+shift')).toBeNull();
    expect(parseKeyBinding('')).toBeNull();
  });

  it('formats bindings using the dialog notation', () => {
    expect(formatKeyBinding({ key: 'b', shift: true })).toBe('⌘⇧B');
    expect(formatKeyBinding({ key: 'f', alt: true })).toBe('⌥⌘F');
    expect(formatKeyBinding({ key: ',' })).toBe('⌘,');
  });

  it('binds new window to command-shift-n by default', () => {
    expect(DEFAULT_SHELL_BINDINGS['file.newWindow']).toEqual({ key: 'n', shift: true });
  });
});

describe('resolveShellBindings', () => {
  it('returns defaults when no overrides exist', () => {
    expect(resolveShellBindings(undefined)).toEqual(DEFAULT_SHELL_BINDINGS);
    expect(resolveShellBindings({})).toEqual(DEFAULT_SHELL_BINDINGS);
  });

  it('applies valid overrides and ignores unknown or malformed entries', () => {
    const bindings = resolveShellBindings({
      'file.newDocument': 'mod+shift+n',
      'unknown.command': 'mod+x',
      'file.save': 'not-a-descriptor',
    });
    expect(bindings['file.newDocument']).toEqual({ key: 'n', shift: true });
    expect(bindings['file.save']).toEqual(DEFAULT_SHELL_BINDINGS['file.save']);
  });
});

describe('findKeymapConflict', () => {
  it('flags system-reserved combinations', () => {
    const conflict = findKeymapConflict('file.newDocument', { key: 'c' }, {});
    expect(conflict).toEqual({ kind: 'system', label: 'Copy (system)' });
  });

  it('flags fixed app shortcuts', () => {
    const conflict = findKeymapConflict('file.newDocument', { key: 'f' }, {});
    expect(conflict?.kind).toBe('fixed');
    expect(conflict?.label).toMatch(/find/i);
  });

  it('flags other commands, respecting their overrides', () => {
    expect(findKeymapConflict('file.newDocument', { key: 's' }, {})).toEqual({
      kind: 'command',
      label: 'Save',
    });
    // After Save moved away from mod+s, mod+s becomes free.
    expect(
      findKeymapConflict('file.newDocument', { key: 's' }, { 'file.save': 'mod+shift+x' }),
    ).toBeNull();
  });

  it('does not conflict with the command being edited', () => {
    expect(
      findKeymapConflict(
        'file.newDocument',
        DEFAULT_SHELL_BINDINGS['file.newDocument'],
        {},
      ),
    ).toBeNull();
  });
});

describe('captureKeyBindingFromEvent', () => {
  it('requires the command modifier and a non-modifier key', () => {
    expect(
      captureKeyBindingFromEvent({ key: 'f', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }),
    ).toBeNull();
    expect(
      captureKeyBindingFromEvent({ key: 'Meta', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }),
    ).toBeNull();
    expect(
      captureKeyBindingFromEvent({ key: 'F', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }),
    ).toEqual({ key: 'f', shift: true });
  });
});

describe('KEYMAP_ROWS', () => {
  it('lists every rebindable shell command exactly once', () => {
    const commandIds = KEYMAP_ROWS.filter((row) => row.commandId).map((row) => row.commandId);
    expect(new Set(commandIds).size).toBe(commandIds.length);
    expect(new Set(commandIds)).toEqual(new Set(Object.keys(DEFAULT_SHELL_BINDINGS)));
  });

  it('has no default binding collisions among rebindable commands', () => {
    const ids = Object.keys(DEFAULT_SHELL_BINDINGS) as Array<keyof typeof DEFAULT_SHELL_BINDINGS>;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(
          bindingsEqual(DEFAULT_SHELL_BINDINGS[a], DEFAULT_SHELL_BINDINGS[b]),
          `${a} and ${b} share a default binding`,
        ).toBe(false);
      }
    }
  });
});
