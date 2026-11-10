import { getMarkRange, type Editor } from '@tiptap/core';
import { isAllowedUri } from '@tiptap/extension-link';
import type {
  Mark as ProseMirrorMark,
  Node as ProseMirrorNode,
} from '@tiptap/pm/model';

export type LinkTarget = {
  kind: 'create' | 'existing';
  from: number;
  to: number;
  sourceText: string;
  displayText: string;
  href: string;
  doc: ProseMirrorNode;
};

export type LinkCaptureResult =
  | { ok: true; target: LinkTarget }
  | { ok: false; reason: 'incompatible-selection' };

export type LinkCaptureOptions = {
  replaceRange?: { from: number; to: number };
  /** Range captured by the requesting toolbar or menu, independent of the live selection. */
  selectionRange?: { from: number; to: number };
  initialDisplayText?: string;
};

export type LinkMutationResult =
  | { ok: true; cursor: number }
  | {
      ok: false;
      reason: 'empty-url' | 'invalid-url' | 'stale-target';
    };

export function captureLinkTarget(
  editor: Editor,
  options?: LinkCaptureOptions,
): LinkCaptureResult {
  const { doc, selection } = editor.state;
  const capturedRange = options?.selectionRange ?? {
    from: selection.from,
    to: selection.to,
  };

  if (!options?.replaceRange) {
    const existing = captureExistingLinkTarget(editor, capturedRange.from);
    if (
      existing &&
      capturedRange.from >= existing.from &&
      capturedRange.to <= existing.to
    ) {
      return { ok: true, target: existing };
    }
  }

  const range = options?.replaceRange ?? capturedRange;

  if (
    range.from < 0 ||
    range.to < range.from ||
    range.to > doc.content.size
  ) {
    return { ok: false, reason: 'incompatible-selection' };
  }

  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) {
    return { ok: false, reason: 'incompatible-selection' };
  }

  const sourceText = doc.textBetween(range.from, range.to, '');
  return {
    ok: true,
    target: {
      kind: 'create',
      from: range.from,
      to: range.to,
      sourceText,
      displayText: options?.initialDisplayText ?? sourceText,
      href: '',
      doc,
    },
  };
}

export function captureExistingLinkTarget(
  editor: Editor,
  position: number,
): LinkTarget | null {
  const { doc, schema } = editor.state;
  const linkType = schema.marks.link;
  if (!linkType || position < 0 || position > doc.content.size) return null;

  const range = getMarkRange(doc.resolve(position), linkType);
  if (!range) return null;

  const mark = doc
    .resolve(range.from)
    .nodeAfter?.marks.find(candidate => candidate.type === linkType);
  if (!mark) return null;

  const displayText = doc.textBetween(range.from, range.to, '');
  return {
    kind: 'existing',
    from: range.from,
    to: range.to,
    sourceText: displayText,
    displayText,
    href: typeof mark.attrs.href === 'string' ? mark.attrs.href : '',
    doc,
  };
}

export function isLinkTargetCurrent(
  editor: Editor,
  target: LinkTarget,
): boolean {
  return editor.state.doc.eq(target.doc);
}

export function isAllowedLinkHref(href: string): boolean {
  const normalized = href.trim();
  return normalized.length > 0 && Boolean(isAllowedUri(normalized));
}

function commonNonLinkMarks(
  editor: Editor,
  target: LinkTarget,
): ProseMirrorMark[] {
  const linkType = editor.state.schema.marks.link;
  let sharedMarks: ProseMirrorMark[] | null = null;

  editor.state.doc.nodesBetween(target.from, target.to, node => {
    if (!node.isText) return;

    const marks = node.marks.filter(mark => mark.type !== linkType);
    sharedMarks =
      sharedMarks === null
        ? [...marks]
        : sharedMarks.filter(shared =>
            marks.some(candidate => candidate.eq(shared)),
          );
  });

  return sharedMarks ?? [];
}

export function applyLinkDraft(
  editor: Editor,
  target: LinkTarget,
  draft: { displayText: string; href: string },
): LinkMutationResult {
  if (!isLinkTargetCurrent(editor, target)) {
    return { ok: false, reason: 'stale-target' };
  }

  const href = draft.href.trim();
  if (!href) return { ok: false, reason: 'empty-url' };
  if (!isAllowedLinkHref(href)) {
    return { ok: false, reason: 'invalid-url' };
  }

  const canSetLink = editor
    .can()
    .chain()
    .setTextSelection({ from: target.from, to: target.to })
    .setLink({ href })
    .run();
  if (!canSetLink) return { ok: false, reason: 'invalid-url' };

  const displayText = draft.displayText.trim()
    ? draft.displayText
    : href;
  const cursor = target.from + displayText.length;

  if (displayText === target.sourceText) {
    editor
      .chain()
      .focus()
      .setTextSelection({ from: target.from, to: target.to })
      .setLink({ href })
      .setTextSelection(cursor)
      .run();
    return { ok: true, cursor };
  }

  const marks = commonNonLinkMarks(editor, target);
  const replacement = editor.state.schema.text(displayText, marks);
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(target.from, target.to, replacement);
      return true;
    })
    .setTextSelection({ from: target.from, to: cursor })
    .setLink({ href })
    .setTextSelection(cursor)
    .run();

  return { ok: true, cursor };
}

export function removeLinkTarget(
  editor: Editor,
  target: LinkTarget,
): LinkMutationResult {
  if (!isLinkTargetCurrent(editor, target)) {
    return { ok: false, reason: 'stale-target' };
  }

  editor
    .chain()
    .focus()
    .setTextSelection({ from: target.from, to: target.to })
    .unsetLink()
    .setTextSelection(target.to)
    .run();
  return { ok: true, cursor: target.to };
}
