import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  CheckSquare,
  Code,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table as TableIcon,
  Type,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type SlashItem = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: typeof Type;
  run: (editor: Editor) => void;
};

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'paragraph',
    title: 'Text',
    description: 'Plain paragraph text.',
    keywords: ['text', 'paragraph', 'plain', 'p'],
    icon: Pilcrow,
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large section heading.',
    keywords: ['h1', 'heading', 'title'],
    icon: Heading1,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading.',
    keywords: ['h2', 'heading'],
    icon: Heading2,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading.',
    keywords: ['h3', 'heading'],
    icon: Heading3,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulleted',
    title: 'Bulleted list',
    description: 'Simple bulleted list.',
    keywords: ['bullet', 'unordered', 'list', 'ul'],
    icon: List,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'List with numbering.',
    keywords: ['numbered', 'ordered', 'list', 'ol'],
    icon: ListOrdered,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    description: 'Track tasks with checkboxes.',
    keywords: ['todo', 'task', 'checkbox', 'check'],
    icon: CheckSquare,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Block quote.',
    keywords: ['quote', 'blockquote'],
    icon: Quote,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Fenced code block.',
    keywords: ['code', 'codeblock', 'pre', 'fenced'],
    icon: Code,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal rule.',
    keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
    icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: 'Table',
    description: '3×3 table with header row.',
    keywords: ['table', 'grid'],
    icon: TableIcon,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'inline-code',
    title: 'Inline code',
    description: 'Toggle inline code mark.',
    keywords: ['inline', 'code', 'mark'],
    icon: Hash,
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
];

type MenuState =
  | { open: false }
  | {
      open: true;
      query: string;
      /** Document position of the slash character. */
      from: number;
      /** Document position immediately after the typed query. */
      to: number;
      top: number;
      left: number;
    };

interface Props {
  editor: Editor | null;
  /** When false, the menu listeners are detached entirely (e.g. non-Wysiwyg mode). */
  enabled?: boolean;
}

/**
 * Notion-style slash command launcher.
 *
 * Watches the active selection for a `/<query>` token at the start of a block
 * (or after whitespace) and offers a filtered list of block-level insertions
 * such as headings, lists, code blocks, and tables.
 */
export function SlashCommandMenu({ editor, enabled = true }: Props) {
  const [menu, setMenu] = useState<MenuState>({ open: false });
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const filteredItems = useMemo(() => {
    if (!menu.open) return SLASH_ITEMS;
    const query = menu.query.trim().toLowerCase();
    if (!query) return SLASH_ITEMS;
    return SLASH_ITEMS.filter((item) => {
      if (item.title.toLowerCase().includes(query)) return true;
      return item.keywords.some((keyword) => keyword.toLowerCase().startsWith(query));
    });
  }, [menu]);

  // Keep activeIndex clamped to filteredItems length.
  useEffect(() => {
    if (!menu.open) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= filteredItems.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filteredItems.length, menu.open]);

  // Keep the active item visible while the user arrows through the list.
  // Without this the selection highlight slides off-screen because the menu
  // body has a capped max-height and overflows.
  useEffect(() => {
    if (!menu.open) return;
    const safeIndex = Math.min(activeIndex, filteredItems.length - 1);
    const node = itemRefs.current[safeIndex];
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filteredItems, menu.open]);

  // Watch editor transactions and recompute menu state.
  useEffect(() => {
    if (!editor || !enabled) {
      setMenu({ open: false });
      return;
    }
    if (typeof editor.on !== 'function' || typeof editor.off !== 'function') {
      // Test mocks and partially-initialized editors don't implement the event
      // bus — skip silently rather than crashing the render.
      return;
    }

    const update = () => {
      const { state } = editor;
      const { from, to, empty } = state.selection;
      if (!empty || from !== to) {
        setMenu({ open: false });
        return;
      }

      const $from = state.selection.$from;
      const blockStart = $from.start($from.depth);
      const textBefore = state.doc.textBetween(blockStart, from, '\n', ' ');
      // Match `/foo` either at the very start of the block or right after a
      // whitespace character. The slash itself must not have whitespace before
      // it in the same chunk.
      const match = textBefore.match(/(?:^|\s)(\/)([^\s/]*)$/);
      if (!match) {
        setMenu({ open: false });
        return;
      }

      const query = match[2] ?? '';
      const slashOffset = match[0].length - query.length - 1;
      const matchStart = from - query.length - 1;
      // Sanity: matchStart must point at the slash character.
      if (matchStart < blockStart || matchStart + slashOffset < 0) {
        setMenu({ open: false });
        return;
      }

      let coords: { top: number; bottom: number; left: number; right: number };
      try {
        coords = editor.view.coordsAtPos(matchStart);
      } catch {
        setMenu({ open: false });
        return;
      }

      setMenu({
        open: true,
        query,
        from: matchStart,
        to: from,
        top: coords.bottom + 6,
        left: coords.left,
      });
    };

    editor.on('selectionUpdate', update);
    editor.on('update', update);
    editor.on('blur', () => setMenu({ open: false }));

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
    };
  }, [editor, enabled]);

  // Keyboard navigation lives on the editor DOM so it runs ahead of Tiptap's
  // own keymap and we can swallow arrows/Enter/Escape while open.
  useEffect(() => {
    if (!editor || !enabled || !menu.open) return;
    const dom = editor.view.dom as HTMLElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) =>
          filteredItems.length === 0 ? 0 : (current + 1) % filteredItems.length,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) =>
          filteredItems.length === 0
            ? 0
            : (current - 1 + filteredItems.length) % filteredItems.length,
        );
        return;
      }
      if (event.key === 'Enter') {
        if (filteredItems.length === 0) {
          setMenu({ open: false });
          return;
        }
        event.preventDefault();
        runItem(filteredItems[Math.min(activeIndex, filteredItems.length - 1)]);
        return;
      }
      if (event.key === 'Tab') {
        if (filteredItems.length === 0) return;
        event.preventDefault();
        runItem(filteredItems[Math.min(activeIndex, filteredItems.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu({ open: false });
        return;
      }
    };

    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, menu, filteredItems, activeIndex]);

  // Close on outside click and on scrolling the editor container.
  useEffect(() => {
    if (!menu.open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenu({ open: false });
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', () => setMenu({ open: false }), { once: true });
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [menu.open]);

  const runItem = (item: SlashItem | undefined) => {
    if (!item || !editor || !menu.open) return;
    const { from, to } = menu;
    setMenu({ open: false });
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .run();
    item.run(editor);
  };

  if (!menu.open) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Insert block"
      data-testid="slash-command-menu"
      className="slash-command-menu"
      style={{ top: menu.top, left: menu.left }}
      onMouseDown={(event) => {
        // Keep the editor selection while clicking menu items.
        event.preventDefault();
      }}
    >
      {filteredItems.length === 0 ? (
        <div className="slash-command-empty">No blocks match &ldquo;{menu.query}&rdquo;</div>
      ) : (
        <ul className="slash-command-list" role="presentation">
          {filteredItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = index === Math.min(activeIndex, filteredItems.length - 1);
            return (
              <li
                key={item.id}
                role="presentation"
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={cn('slash-command-item', isActive && 'is-active')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runItem(item)}
                  data-active={isActive ? 'true' : undefined}
                >
                  <span className="slash-command-icon" aria-hidden="true">
                    <Icon className="size-4" />
                  </span>
                  <span className="slash-command-text">
                    <span className="slash-command-title">{item.title}</span>
                    <span className="slash-command-description">{item.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    portalTarget,
  );
}

export default SlashCommandMenu;
