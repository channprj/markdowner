import { describe, expect, it } from 'vitest';

import { parseNativeMenuCommand } from './nativeMenuCommand';

describe('parseNativeMenuCommand', () => {
  it('parses recent document commands without altering the path', () => {
    expect(parseNativeMenuCommand('open-recent-document:/tmp/project/meeting-notes.md')).toEqual({
      kind: 'openRecentDocument',
      path: '/tmp/project/meeting-notes.md',
    });
    expect(parseNativeMenuCommand('open-recent-document:/tmp/project/a:b.md')).toEqual({
      kind: 'openRecentDocument',
      path: '/tmp/project/a:b.md',
    });
    expect(parseNativeMenuCommand('open-recent-document:')).toEqual({
      kind: 'openRecentDocument',
      path: '',
    });
  });

  it.each([
    ['new-document', { kind: 'newDocument' }],
    ['new-window', { kind: 'newWindow' }],
    ['open-document', { kind: 'openDocument' }],
    ['open-workspace', { kind: 'openWorkspace' }],
    ['save-active-document', { kind: 'saveActiveDocument' }],
    ['save-active-document-as', { kind: 'saveActiveDocumentAs' }],
    ['close-window', { kind: 'closeWindow' }],
    ['quit-app', { kind: 'quitApp' }],
  ] as const)('parses %s', (command, expected) => {
    expect(parseNativeMenuCommand(command)).toEqual(expected);
  });

  it.each([
    ['mode-wysiwyg', 'Wysiwyg'],
    ['mode-editor', 'Editor'],
    ['mode-splitview', 'SplitView'],
  ] as const)('parses %s as a mode change', (command, mode) => {
    expect(parseNativeMenuCommand(command)).toEqual({
      kind: 'setMode',
      mode,
    });
  });

  it('returns unknown for commands that are not native menu actions', () => {
    expect(parseNativeMenuCommand('')).toEqual({ kind: 'unknown' });
    expect(parseNativeMenuCommand('open-recent-doc:/tmp/project/a.md')).toEqual({
      kind: 'unknown',
    });
  });
});
