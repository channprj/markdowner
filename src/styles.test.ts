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

describe('WYSIWYG inline code typography stylesheet', () => {
  it('inherits the surrounding text size and line height', () => {
    const inlineCodeRule = ruleBody(
      '.editor-pane-wysiwyg .notion-editor-content .ProseMirror :not(pre) > code',
    );

    expect(inlineCodeRule).toContain('font-size: inherit;');
    expect(inlineCodeRule).toContain('line-height: inherit;');
  });
});

describe('shared inline style color stylesheet', () => {
  it('defines neutral root fallbacks for skill tokens and inline code', () => {
    const rootRule = ruleBody(':root');

    expect(rootRule).toContain('--skill-token-text-color: #18181b;');
    expect(rootRule).toContain('--skill-token-background-color: #f4f4f5;');
    expect(rootRule).toContain('--inline-code-text-color: #18181b;');
    expect(rootRule).toContain('--inline-code-background-color: #f4f4f5;');
  });

  it('uses shared variables for skill tokens in every rendered surface', () => {
    for (const selector of [
      '.cm-skill-token',
      '.wysiwyg-skill-token',
      '.preview-skill-token',
    ]) {
      const rule = ruleBody(selector);
      expect(rule).toContain('color: var(--skill-token-text-color);');
      expect(rule).toContain(
        'background-color: var(--skill-token-background-color);',
      );
    }
  });

  it('uses shared variables for source and rendered inline code', () => {
    for (const selector of [
      '.cm-inline-code',
      '.markdown-surface :not(pre) > code',
    ]) {
      const rule = ruleBody(selector);
      expect(rule).toContain('color: var(--inline-code-text-color);');
      expect(rule).toContain(
        'background-color: var(--inline-code-background-color);',
      );
    }
    expect(ruleBody('.markdown-surface pre code')).toContain(
      'background-color: transparent;',
    );
  });
});

describe('Mermaid block layout stylesheet', () => {
  it('keeps the Mermaid frame and diagram canvas square', () => {
    expect(ruleBody('.code-block-view-mermaid')).toContain('border-radius: 0;');
    expect(ruleBody('.mermaid-diagram-canvas')).toContain('border-radius: 0;');
  });

  it('renders the source as a square footer instead of a nested pre card', () => {
    for (const declaration of ['border: 0;', 'border-radius: 0;', 'padding: 0;']) {
      expect(ruleBody('.mermaid-source-pre')).toContain(declaration);
    }
    expect(ruleBody('.mermaid-source-shell')).toContain(
      'padding: 0.7rem 1rem 1rem;',
    );
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
