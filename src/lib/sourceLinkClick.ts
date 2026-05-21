import { EditorView } from '@uiw/react-codemirror';

import { isOpenLinkClick, openMarkdownLink } from './linkOpener';
import { findMarkdownLinkUrlAtOffset } from './markdownLinkScanner';

/**
 * CodeMirror extension that opens the link under the cursor when the user
 * Cmd+Clicks (or Ctrl+Clicks on Windows/Linux). Mirrors the WYSIWYG /
 * Split-View preview behavior so users get the same "modifier + click =
 * follow link" convention everywhere VS Code / Zed put it.
 *
 * The `getBasePath` callback returns the active document's absolute path so
 * relative targets like `[notes](./other.md)` resolve correctly.
 */
export function createSourceLinkClickExtension(getBasePath: () => string | null) {
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
      void openMarkdownLink(url, getBasePath()).catch(() => {
        // Non-fatal — user can always copy/paste manually.
      });
      return true;
    },
  });
}
