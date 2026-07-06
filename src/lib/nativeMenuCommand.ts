import type { EditorMode } from './desktop';

const OPEN_RECENT_DOCUMENT_PREFIX = 'open-recent-document:';

export type NativeMenuCommand =
  | { kind: 'newDocument' }
  | { kind: 'newWindow' }
  | { kind: 'openDocument' }
  | { kind: 'openWorkspace' }
  | { kind: 'saveActiveDocument' }
  | { kind: 'saveActiveDocumentAs' }
  | { kind: 'closeWindow' }
  | { kind: 'quitApp' }
  | { kind: 'setMode'; mode: EditorMode }
  | { kind: 'openRecentDocument'; path: string }
  | { kind: 'unknown' };

export function parseNativeMenuCommand(command: string): NativeMenuCommand {
  if (command.startsWith(OPEN_RECENT_DOCUMENT_PREFIX)) {
    return {
      kind: 'openRecentDocument',
      path: command.slice(OPEN_RECENT_DOCUMENT_PREFIX.length),
    };
  }

  switch (command) {
    case 'new-document':
      return { kind: 'newDocument' };
    case 'new-window':
      return { kind: 'newWindow' };
    case 'open-document':
      return { kind: 'openDocument' };
    case 'open-workspace':
      return { kind: 'openWorkspace' };
    case 'save-active-document':
      return { kind: 'saveActiveDocument' };
    case 'save-active-document-as':
      return { kind: 'saveActiveDocumentAs' };
    case 'close-window':
      return { kind: 'closeWindow' };
    case 'quit-app':
      return { kind: 'quitApp' };
    case 'mode-wysiwyg':
      return { kind: 'setMode', mode: 'Wysiwyg' };
    case 'mode-editor':
      return { kind: 'setMode', mode: 'Editor' };
    case 'mode-splitview':
      return { kind: 'setMode', mode: 'SplitView' };
    default:
      return { kind: 'unknown' };
  }
}
