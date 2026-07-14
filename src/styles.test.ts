import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/styles.css', 'utf8');

function ruleBody(selector: string, css = stylesheet): string {
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const match of cssWithoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((candidate) => candidate.trim());
    if (selectors.includes(selector)) return match[2] ?? '';
  }

  return '';
}

describe('stylesheet rule lookup', () => {
  it('matches exact selectors within comma-separated rule lists', () => {
    const css = `
      .fixture > pre > code,
      .fixture-secondary { white-space: pre-wrap; }
    `;

    expect(ruleBody('.fixture > pre', css)).toBe('');
    expect(ruleBody('.fixture > pre > code', css)).toContain(
      'white-space: pre-wrap;',
    );
    expect(ruleBody('.fixture-secondary', css)).toContain(
      'white-space: pre-wrap;',
    );
  });
});

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
  it('keeps ordinary and Mermaid source code unwrapped when the WYSIWYG toggle is off', () => {
    const selectors = [
      ".editor-pane-wysiwyg[data-code-block-wrap='off'] .notion-editor-content .ProseMirror .code-block-view > pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='off'] .notion-editor-content .ProseMirror .mermaid-source-pre",
    ];

    for (const selector of selectors) {
      const rule = ruleBody(selector);
      expect(rule).toContain('white-space: pre;');
      expect(rule).toContain('overflow-wrap: normal;');
    }
    expect(stylesheet).not.toContain(
      ".editor-pane-preview[data-code-block-wrap='off']",
    );
  });

  it('wraps ordinary and Mermaid source code only when the WYSIWYG toggle is on', () => {
    const selectors = [
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .code-block-view > pre > code",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre",
      ".editor-pane-wysiwyg[data-code-block-wrap='on'] .notion-editor-content .ProseMirror .mermaid-source-pre > code",
    ];

    for (const selector of selectors) {
      const rule = ruleBody(selector);
      expect(rule).toContain('white-space: pre-wrap;');
      expect(rule).toContain('overflow-wrap: anywhere;');
    }
    expect(stylesheet).not.toContain(
      ".editor-pane-preview[data-code-block-wrap='on']",
    );
  });
});
