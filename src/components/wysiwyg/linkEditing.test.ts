import { Editor, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { WYSIWYG_LINK_OPTIONS } from '@/lib/wysiwygLinkOptions';

import {
  applyLinkDraft,
  captureExistingLinkTarget,
  captureLinkTarget,
  isAllowedLinkHref,
  isLinkTargetCurrent,
  removeLinkTarget,
} from './linkEditing';

const editors: Editor[] = [];
const hosts: HTMLDivElement[] = [];

function buildEditor(content: Content): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);

  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        link: WYSIWYG_LINK_OPTIONS,
        codeBlock: false,
      }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function readLinks(editor: Editor): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const linkType = editor.state.schema.marks.link;

  editor.state.doc.descendants(node => {
    if (!node.isText) return;
    const link = node.marks.find(mark => mark.type === linkType);
    if (link) {
      links.push({
        text: node.text ?? '',
        href: typeof link.attrs.href === 'string' ? link.attrs.href : '',
      });
    }
  });

  return links;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe('WYSIWYG link target capture', () => {
  it('captures selected text without changing the document', () => {
    const editor = buildEditor('<p>Read docs now</p>');
    editor.commands.setTextSelection({ from: 6, to: 10 });
    const before = editor.getHTML();

    expect(captureLinkTarget(editor)).toMatchObject({
      ok: true,
      target: {
        kind: 'create',
        from: 6,
        to: 10,
        sourceText: 'docs',
        displayText: 'docs',
        href: '',
      },
    });
    expect(editor.getHTML()).toBe(before);
  });

  it('captures the range supplied by the requesting toolbar', () => {
    const editor = buildEditor('<p>Read docs now</p>');
    editor.commands.setTextSelection(1);

    expect(
      captureLinkTarget(editor, {
        selectionRange: { from: 6, to: 10 },
      }),
    ).toMatchObject({
      ok: true,
      target: {
        kind: 'create',
        from: 6,
        to: 10,
        sourceText: 'docs',
        displayText: 'docs',
      },
    });
  });

  it('captures a collapsed caret without inserting placeholder content', () => {
    const editor = buildEditor('<p>Before after</p>');
    editor.commands.setTextSelection(8);
    const before = editor.getHTML();

    expect(captureLinkTarget(editor)).toMatchObject({
      ok: true,
      target: {
        kind: 'create',
        from: 8,
        to: 8,
        sourceText: '',
        displayText: '',
        href: '',
      },
    });
    expect(editor.getHTML()).toBe(before);
  });

  it('captures a slash replacement range while preserving its source text', () => {
    const editor = buildEditor('<p>/link</p>');
    const before = editor.getHTML();

    expect(
      captureLinkTarget(editor, {
        replaceRange: { from: 1, to: 6 },
        initialDisplayText: '',
      }),
    ).toMatchObject({
      ok: true,
      target: {
        kind: 'create',
        from: 1,
        to: 6,
        sourceText: '/link',
        displayText: '',
        href: '',
      },
    });
    expect(editor.getHTML()).toBe(before);
  });

  it('expands a caret inside an existing link to the complete link range', () => {
    const editor = buildEditor(
      '<p><a href="https://old.example">docs</a> tail</p>',
    );
    editor.commands.setTextSelection(3);

    expect(captureLinkTarget(editor)).toMatchObject({
      ok: true,
      target: {
        kind: 'existing',
        from: 1,
        to: 5,
        sourceText: 'docs',
        displayText: 'docs',
        href: 'https://old.example',
      },
    });
  });

  it('captures an existing link from a position at its DOM boundary', () => {
    const editor = buildEditor(
      '<p><a href="https://old.example">docs</a> tail</p>',
    );

    expect(captureExistingLinkTarget(editor, 1)).toMatchObject({
      kind: 'existing',
      from: 1,
      to: 5,
      sourceText: 'docs',
      displayText: 'docs',
      href: 'https://old.example',
    });
  });

  it('rejects a selection that spans multiple text blocks', () => {
    const editor = buildEditor('<p>one</p><p>two</p>');
    editor.commands.setTextSelection({ from: 2, to: 7 });
    const before = editor.getHTML();

    expect(captureLinkTarget(editor)).toEqual({
      ok: false,
      reason: 'incompatible-selection',
    });
    expect(editor.getHTML()).toBe(before);
  });
});

describe('WYSIWYG link mutations', () => {
  it('accepts safe absolute, relative, and anchor hrefs', () => {
    expect(isAllowedLinkHref('https://example.com/docs')).toBe(true);
    expect(isAllowedLinkHref('./next.md')).toBe(true);
    expect(isAllowedLinkHref('#heading')).toBe(true);
    expect(isAllowedLinkHref('')).toBe(false);
    expect(isAllowedLinkHref('   ')).toBe(false);
    expect(isAllowedLinkHref('javascript:alert(1)')).toBe(false);
  });

  it('links the selected text without replacing it', () => {
    const editor = buildEditor('<p>Read docs now</p>');
    editor.commands.setTextSelection({ from: 6, to: 10 });
    const captured = captureLinkTarget(editor);
    if (!captured.ok) throw new Error('expected a compatible target');

    expect(
      applyLinkDraft(editor, captured.target, {
        displayText: 'docs',
        href: 'https://example.com/docs',
      }),
    ).toEqual({ ok: true, cursor: 10 });
    expect(readLinks(editor)).toEqual([
      { text: 'docs', href: 'https://example.com/docs' },
    ]);
    expect(editor.getText()).toBe('Read docs now');
  });

  it('uses the URL as text when the optional label is blank', () => {
    const editor = buildEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Before  after' }],
        },
      ],
    });
    editor.commands.setTextSelection(8);
    const captured = captureLinkTarget(editor);
    if (!captured.ok) throw new Error('expected a compatible target');

    expect(
      applyLinkDraft(editor, captured.target, {
        displayText: '   ',
        href: ' https://example.com ',
      }),
    ).toEqual({ ok: true, cursor: 27 });
    expect(readLinks(editor)).toEqual([
      { text: 'https://example.com', href: 'https://example.com' },
    ]);
    expect(editor.getText()).toBe('Before https://example.com after');
  });

  it('edits only the URL while preserving strong text', () => {
    const editor = buildEditor(
      '<p><strong><a href="https://old.example">docs</a></strong> tail</p>',
    );
    const target = captureExistingLinkTarget(editor, 3);
    if (!target) throw new Error('expected an existing link');

    expect(
      applyLinkDraft(editor, target, {
        displayText: 'docs',
        href: 'https://new.example',
      }),
    ).toEqual({ ok: true, cursor: 5 });
    expect(readLinks(editor)).toEqual([
      { text: 'docs', href: 'https://new.example' },
    ]);
    expect(
      editor.state.doc.nodeAt(1)?.marks.map(mark => mark.type.name).sort(),
    ).toEqual(['bold', 'link']);
  });

  it('edits text and URL while retaining marks shared across the link', () => {
    const editor = buildEditor(
      '<p><strong><a href="https://old.example">docs</a></strong> tail</p>',
    );
    const target = captureExistingLinkTarget(editor, 3);
    if (!target) throw new Error('expected an existing link');

    expect(
      applyLinkDraft(editor, target, {
        displayText: 'Guides',
        href: 'https://new.example/guides',
      }),
    ).toEqual({ ok: true, cursor: 7 });
    expect(readLinks(editor)).toEqual([
      { text: 'Guides', href: 'https://new.example/guides' },
    ]);
    expect(editor.getText()).toBe('Guides tail');
    expect(
      editor.state.doc.nodeAt(1)?.marks.map(mark => mark.type.name).sort(),
    ).toEqual(['bold', 'link']);
  });

  it.each(['./next.md', '#heading'])(
    'creates a link for the safe href %s',
    href => {
      const editor = buildEditor('<p>next</p>');
      editor.commands.setTextSelection({ from: 1, to: 5 });
      const captured = captureLinkTarget(editor);
      if (!captured.ok) throw new Error('expected a compatible target');

      expect(
        applyLinkDraft(editor, captured.target, {
          displayText: 'next',
          href,
        }),
      ).toEqual({ ok: true, cursor: 5 });
      expect(readLinks(editor)).toEqual([{ text: 'next', href }]);
    },
  );

  it('removes only the link mark and preserves text formatting', () => {
    const editor = buildEditor(
      '<p><strong><a href="https://old.example">docs</a></strong> tail</p>',
    );
    const target = captureExistingLinkTarget(editor, 3);
    if (!target) throw new Error('expected an existing link');

    expect(removeLinkTarget(editor, target)).toEqual({ ok: true, cursor: 5 });
    expect(readLinks(editor)).toEqual([]);
    expect(editor.getText()).toBe('docs tail');
    expect(editor.getHTML()).toBe('<p><strong>docs</strong> tail</p>');
  });

  it('rejects an empty URL without changing the document', () => {
    const editor = buildEditor('<p>docs</p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    const captured = captureLinkTarget(editor);
    if (!captured.ok) throw new Error('expected a compatible target');
    const before = editor.getHTML();

    expect(
      applyLinkDraft(editor, captured.target, {
        displayText: 'changed',
        href: '   ',
      }),
    ).toEqual({ ok: false, reason: 'empty-url' });
    expect(editor.getHTML()).toBe(before);
  });

  it('rejects an unsafe URL without changing the document', () => {
    const editor = buildEditor('<p>docs</p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    const captured = captureLinkTarget(editor);
    if (!captured.ok) throw new Error('expected a compatible target');
    const before = editor.getHTML();

    expect(
      applyLinkDraft(editor, captured.target, {
        displayText: 'changed',
        href: 'javascript:alert(1)',
      }),
    ).toEqual({ ok: false, reason: 'invalid-url' });
    expect(editor.getHTML()).toBe(before);
  });

  it('rejects a stale target without mutating the newer document', () => {
    const editor = buildEditor('<p>docs</p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    const captured = captureLinkTarget(editor);
    if (!captured.ok) throw new Error('expected a compatible target');

    editor.commands.insertContentAt(1, 'new ');
    const before = editor.getHTML();
    expect(isLinkTargetCurrent(editor, captured.target)).toBe(false);
    expect(
      applyLinkDraft(editor, captured.target, {
        displayText: 'changed',
        href: 'https://example.com',
      }),
    ).toEqual({ ok: false, reason: 'stale-target' });
    expect(removeLinkTarget(editor, captured.target)).toEqual({
      ok: false,
      reason: 'stale-target',
    });
    expect(editor.getHTML()).toBe(before);
  });
});
