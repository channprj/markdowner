import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/styles.css', 'utf8');

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));

  return match?.[1] ?? '';
}

function ruleBodyContaining(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(
    new RegExp(`[^{}]*${escapedSelector}[^{}]*\\{([^}]*)\\}`),
  );

  return match?.[1] ?? '';
}

describe('editor word wrap stylesheet', () => {
  it('disables automatic ProseMirror wrapping when WYSIWYG word wrap is off', () => {
    const proseMirrorRule = ruleBody(
      ".editor-pane-wysiwyg[data-line-wrap='false'] .notion-editor-content .ProseMirror",
    );

    expect(proseMirrorRule).toContain('white-space: pre;');
    expect(proseMirrorRule).toContain('overflow-wrap: normal;');
    expect(proseMirrorRule).toContain('word-wrap: normal;');
  });
});

describe('WYSIWYG code block wrapping stylesheet', () => {
  it('wraps ordinary and Mermaid source code only when the WYSIWYG toggle is on', () => {
    const selectors = [
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre > code",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre > code",
    ];

    for (const selector of selectors) {
      const rule = ruleBodyContaining(selector);
      expect(rule).toContain('white-space: pre-wrap;');
      expect(rule).toContain('overflow-wrap: anywhere;');
    }
    expect(stylesheet).not.toContain(
      ".editor-pane-preview[data-code-block-wrap='on']",
    );
  });
});
