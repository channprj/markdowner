import { EditorView } from '@uiw/react-codemirror';

import { publishEditorEvent } from './editorEvents';
import { isOpenLinkClick } from './linkOpener';
import { findMarkdownLinkUrlAtOffset } from './markdownLinkScanner';

/**
 * CodeMirror extension that opens the link under the cursor when the user
 * Cmd+Clicks (or Ctrl+Clicks on Windows/Linux). Mirrors the WYSIWYG /
 * Split-View preview behavior so users get the same "modifier + click =
 * follow link" convention everywhere VS Code / Zed put it.
 *
 * The actual open is routed through the `'link:open'` editor event so the CM
 * extension stays decoupled from App's tab/snapshot plumbing — App subscribes
 * once and resolves the href against the active document.
 */
export function createSourceLinkClickExtension() {
  return EditorView.domEventHandlers({
    click(event, view) {
      if (!isOpenLinkClick(event)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const offsetInLine = pos - line.from;
      const url = findMarkdownLinkUrlAtOffset(line.text, offsetInLine);
      if (!url) return false;
      event.preventDefault();
      publishEditorEvent('link:open', { href: url, openInNewTab: false });
      return true;
    },
  });
}
