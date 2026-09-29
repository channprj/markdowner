import { Node, nodeInputRule, wrappingInputRule, type MarkdownToken, type NodeViewRenderer } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const referencePattern = /^\[\^([^\]\s]+)\]/;
const definitionPattern = /^ {0,3}\[\^([^\]\s]+)\]:[\t ]*(.*)(?:\n|$)/;
const key = new PluginKey<DecorationSet>('footnotes');
const normalizeLabel = (label: string) => label.toLowerCase();

// Numbers are display state only. The Markdown always retains the author's
// labels, including numeric labels and repeated references to the same note.
function footnoteDecorations(doc: ProseMirrorNode): DecorationSet {
  const definitions = new Map<string, { pos: number; text: string }>();
  const references = new Map<string, { pos: number; number: number }>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnoteDefinition') return;
    const label = normalizeLabel(node.attrs.label);
    if (!definitions.has(label)) definitions.set(label, { pos, text: node.textContent });
  });
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnoteReference') return;
    const label = normalizeLabel(node.attrs.label);
    if (definitions.has(label) && !references.has(label)) {
      references.set(label, { pos, number: references.size + 1 });
    }
  });
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    const isReference = node.type.name === 'footnoteReference';
    if (!isReference && node.type.name !== 'footnoteDefinition') return;
    const label = normalizeLabel(node.attrs.label);
    const definition = definitions.get(label);
    const reference = references.get(label);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, {
      number: reference?.number,
      target: isReference ? (definition ? definition.pos + 2 : undefined) : reference?.pos,
      title: definition?.text,
    }));
  });
  return DecorationSet.create(doc, decorations);
}

function footnoteNodeView(isReference: boolean): NodeViewRenderer {
  return ({ node, editor, decorations }) => {
    const dom = document.createElement(isReference ? 'sup' : 'div');
    const button = document.createElement('button');
    button.type = 'button';
    button.contentEditable = 'false';
    button.className = 'footnote-label';
    dom.append(button);
    const contentDOM = isReference ? undefined : document.createElement('div');
    if (contentDOM) {
      contentDOM.setAttribute('data-footnote-content', '');
      dom.append(contentDOM);
    }
    let target: number | undefined;
    const update = (next: ProseMirrorNode, nextDecorations: readonly Decoration[]) => {
      if (next.type !== node.type) return false;
      const info = nextDecorations.find(decoration => 'target' in decoration.spec)?.spec;
      const label = String(next.attrs.label);
      dom.setAttribute(isReference ? 'data-footnote-reference' : 'data-footnote-definition', label);
      target = info?.target;
      button.textContent = isReference
        ? String(info?.number ?? `[^${label}]`)
        : `${info?.number ? `${info.number}. ` : ''}[^${label}]`;
      button.title = isReference ? (info?.title ?? `Undefined footnote: ${label}`) : `Return to reference: ${label}`;
      button.setAttribute('aria-label', isReference ? `Footnote ${label}: ${button.title}` : button.title);
      button.disabled = target === undefined;
      return true;
    };
    update(node, decorations);
    button.onmousedown = event => event.preventDefault();
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (target !== undefined) editor.chain().setTextSelection(target).focus().scrollIntoView().run();
    };
    return {
      dom,
      contentDOM,
      update,
      stopEvent: event => button.contains(event.target as globalThis.Node),
      ignoreMutation: mutation => mutation.type !== 'selection' && !contentDOM?.contains(mutation.target),
    };
  };
}

export const FootnoteReference = Node.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { label: { default: '', rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote-reference]', getAttrs: element => ({ label: element.getAttribute('data-footnote-reference') }) }];
  },
  renderHTML({ node }) {
    return ['sup', { 'data-footnote-reference': node.attrs.label }, `[^${node.attrs.label}]`];
  },
  renderText({ node }) {
    return `[^${node.attrs.label}]`;
  },
  addNodeView() {
    return footnoteNodeView(true);
  },
  addInputRules() {
    // Wait for a space so typing [^label]: can still start a definition.
    return [nodeInputRule({
      find: /(?<!\\)(\[\^([^\]\s]+)\]) $/,
      type: this.type,
      getAttributes: match => ({ label: match[2] }),
    })];
  },
  markdownTokenName: 'footnoteReference',
  markdownTokenizer: {
    name: 'footnoteReference',
    level: 'inline',
    start: source => source.indexOf('[^'),
    tokenize(source) {
      const match = referencePattern.exec(source);
      if (!match) return undefined;
      return { type: 'footnoteReference', raw: match[0], label: match[1] };
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('footnoteReference', { label: token.label });
  },
  renderMarkdown(node) {
    return `[^${node.attrs?.label}]`;
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_, state) => footnoteDecorations(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? footnoteDecorations(transaction.doc) : previous,
      },
      props: { decorations: state => key.getState(state) },
    })];
  },
});

export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  priority: 90,
  addAttributes() {
    return { label: { default: '', rendered: false } };
  },
  parseHTML() {
    return [{
      tag: 'div[data-footnote-definition]',
      contentElement: '[data-footnote-content]',
      getAttrs: element => ({ label: element.getAttribute('data-footnote-definition') }),
    }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-footnote-definition': node.attrs.label },
      ['span', { contenteditable: 'false', class: 'footnote-label' }, `[^${node.attrs.label}]`],
      ['div', { 'data-footnote-content': '' }, 0],
    ];
  },
  addNodeView() {
    return footnoteNodeView(false);
  },
  addInputRules() {
    return [wrappingInputRule({
      find: /^\[\^([^\]\s]+)\]: $/,
      type: this.type,
      getAttributes: match => ({ label: match[1] }),
      joinPredicate: () => false,
    })];
  },
  markdownTokenName: 'footnoteDefinition',
  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block',
    start: source => source.search(/^ {0,3}\[\^[^\]\s]+\]:/m),
    tokenize(source, _tokens, lexer) {
      const match = definitionPattern.exec(source);
      if (!match) return undefined;
      let raw = match[0];
      const lines = [match[2]];
      const remaining = source.slice(raw.length).split('\n');
      for (let index = 0; index < remaining.length; index += 1) {
        const line = remaining[index];
        if (/^( {4}|\t)/.test(line)) {
          lines.push(line.replace(/^( {4}|\t)/, ''));
        } else if (!line.trim() && remaining.slice(index + 1).find(next => next.trim())?.match(/^( {4}|\t)/)) {
          lines.push('');
        } else if (line.trim() && lines[lines.length - 1]?.trim() && !definitionPattern.test(line)) {
          // Let the existing block lexer decide whether an unindented line
          // continues a paragraph or starts a heading/list/table/etc.
          const previous = lexer.blockTokens(lines.join('\n'));
          const continued = lexer.blockTokens([...lines, line].join('\n'));
          if (previous[previous.length - 1]?.type !== 'paragraph' || continued.length !== previous.length || continued[continued.length - 1]?.type !== 'paragraph') break;
          lines.push(line);
        } else {
          break;
        }
        raw += line + (raw.length + line.length < source.length ? '\n' : '');
      }
      return { type: 'footnoteDefinition', raw, label: match[1], tokens: lexer.blockTokens(lines.join('\n')) };
    },
  },
  parseMarkdown(token: MarkdownToken, helpers) {
    const content = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode('footnoteDefinition', { label: token.label }, content.length ? content : [helpers.createNode('paragraph')]);
  },
  renderMarkdown(node, helpers) {
    const body = helpers.renderChildren(node.content ?? [], '\n\n');
    return `[^${node.attrs?.label}]: ${body.replace(/\n/g, '\n    ')}`;
  },
});

export const FootnoteExtensions = [FootnoteReference, FootnoteDefinition];
