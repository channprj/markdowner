import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  CheckSquare,
  Code,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Image as ImageIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table as TableIcon,
  Type,
} from 'lucide-react';

import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { cn } from '@/lib/utils';
import { importImageAsset } from '@/lib/desktop';
import { publishEditorEvent, subscribeEditorEvent } from '@/lib/editorEvents';
import { IMAGE_FILE_EXTENSIONS } from '@/lib/fileDialogOptions';

import { filterSlashItems } from './slashItemFilter';

type SlashItemKind = 'block' | 'prompt-image' | 'pick-image';

type SlashItem = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: typeof Type;
  kind?: SlashItemKind;
  /**
   * Whether the item reformats existing content (heading, list, quote, …) as
   * opposed to inserting something new (table, image, divider, link). Only
   * convertible items appear in the Cmd+/ Turn-into menu.
   */
  convertible?: boolean;
  run?: (editor: Editor) => void;
};

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'paragraph',
    title: 'Text',
    description: 'Plain paragraph text.',
    keywords: ['text', 'paragraph', 'plain', 'p', '텍스트', '본문', '문단'],
    icon: Pilcrow,
    convertible: true,
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large section heading.',
    keywords: ['h1', 'heading', 'title', '제목1', '제목', '큰제목', '헤딩'],
    icon: Heading1,
    convertible: true,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading.',
    keywords: ['h2', 'heading', '제목2', '제목', '헤딩'],
    icon: Heading2,
    convertible: true,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading.',
    keywords: ['h3', 'heading', '제목3', '제목', '헤딩'],
    icon: Heading3,
    convertible: true,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'h4',
    title: 'Heading 4',
    description: 'Sub-section heading.',
    keywords: ['h4', 'heading', '제목4', '제목', '헤딩'],
    icon: Heading4,
    convertible: true,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 4 }).run(),
  },
  {
    id: 'h5',
    title: 'Heading 5',
    description: 'Smallest section heading.',
    keywords: ['h5', 'heading', '제목5', '제목', '헤딩'],
    icon: Heading5,
    convertible: true,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 5 }).run(),
  },
  {
    id: 'bulleted',
    title: 'Bulleted list',
    description: 'Simple bulleted list.',
    keywords: ['bullet', 'unordered', 'list', 'ul', '목록', '글머리기호', '리스트', '불릿'],
    icon: List,
    convertible: true,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'List with numbering.',
    keywords: ['numbered', 'ordered', 'list', 'ol', '번호목록', '순서목록', '숫자목록', '번호매기기'],
    icon: ListOrdered,
    convertible: true,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    description: 'Track tasks with checkboxes.',
    keywords: ['todo', 'task', 'checkbox', 'check', '할일', '체크리스트', '체크박스', '투두'],
    icon: CheckSquare,
    convertible: true,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Block quote.',
    keywords: ['quote', 'blockquote', '인용', '인용구'],
    icon: Quote,
    convertible: true,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Fenced code block.',
    keywords: ['code', 'codeblock', 'pre', 'fenced', '코드', '코드블록'],
    icon: Code,
    convertible: true,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal rule.',
    keywords: ['divider', 'hr', 'rule', 'separator', 'line', '구분선', '구분', '가로줄'],
    icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: 'Table',
    description: '3×3 table with header row.',
    keywords: ['table', 'grid', '표', '테이블'],
    icon: TableIcon,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'inline-code',
    title: 'Inline code',
    description: 'Toggle inline code mark.',
    keywords: ['inline', 'code', 'mark', '인라인코드', '인라인'],
    icon: Hash,
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Insert an image file from disk.',
    keywords: ['image', 'img', 'picture', 'photo', 'file', 'upload', '이미지', '그림', '사진', '파일', '업로드'],
    icon: ImageIcon,
    // Opens the native file picker; the chosen file is copied into the
    // document's asset folder by the Rust shell so the markdown embeds a
    // doc-relative path that keeps rendering after the file moves with the
    // document. Unsaved docs fall back to the absolute path.
    kind: 'pick-image',
  },
  {
    id: 'image-url',
    title: 'Image from URL',
    description: 'Embed an image by URL.',
    keywords: ['image', 'img', 'url', 'picture', 'photo', '이미지', '그림', '사진', '주소'],
    icon: ImageIcon,
    // The runner sub-mode lives inside the menu — window.prompt is unreliable
    // in WKWebView (Tauri) and feels jarring inside a desktop app. The image
    // URL input is rendered as a secondary panel within this same portal so
    // focus / keyboard handling stays consistent with the rest of the menu.
    kind: 'prompt-image',
  },
  {
    id: 'link',
    title: 'Link',
    description: 'Insert or convert text into a link.',
    keywords: ['link', 'url', 'hyperlink', 'anchor', '링크', '주소'],
    icon: LinkIcon,
    run: (editor) => {
      // Apply a placeholder link mark on whatever the caret currently covers,
      // then ask the floating LinkPopup to focus its URL input so the user
      // can type immediately. Mirrors the selection-toolbar Link flow.
      const { from, to } = editor.state.selection;
      if (from === to) {
        editor
          .chain()
          .focus()
          .insertContent('link')
          .setTextSelection({ from, to: from + 4 })
          .run();
      }
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: 'https://' })
        .run();
      publishEditorEvent('link:edit-request', { focusInput: true });
    },
  },
];

type MenuStage = 'list' | 'image-url';

type MenuMode = 'insert' | 'convert';

type MenuState =
  | { open: false }
  | {
      open: true;
      stage: MenuStage;
      /**
       * 'insert' is the typed-slash flow: `from`/`to` cover the `/query`
       * text, which gets deleted before the chosen block is inserted.
       * 'convert' is the Cmd+/ Turn-into flow: the chosen command reformats
       * the current selection (or the caret's line) and nothing is deleted.
       */
      mode: MenuMode;
      query: string;
      /** Document position of the slash character. */
      from: number;
      /** Document position immediately after the typed query. */
      to: number;
      /** Viewport coords for the slash caret line — used to decide above/below placement. */
      cursorTop: number;
      cursorBottom: number;
      left: number;
    };

/**
 * Node types Cmd+/ refuses to reformat. Tables would have their cell
 * paragraphs mangled by setNode, and image/divider blocks have no text to
 * convert — the menu simply doesn't open when the selection touches one.
 */
const NON_CONVERTIBLE_NODE_TYPES = new Set(['table', 'image', 'horizontalRule']);

/** True when every block the selection touches may be reformatted. */
function selectionSupportsConvert(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  let convertible = true;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (NON_CONVERTIBLE_NODE_TYPES.has(node.type.name)) {
      convertible = false;
    }
    return convertible;
  });
  return convertible;
}

type Placement = 'below' | 'above';

/** Pixels of breathing room between the menu and the cursor / viewport edges. */
const MENU_GUTTER = 6;
const VIEWPORT_MARGIN = 8;

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
  const [placement, setPlacement] = useState<Placement>('below');
  const [imageUrl, setImageUrl] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const filteredItems = useMemo(() => {
    // The Turn-into menu only offers reformat targets — inserting a table or
    // divider over the user's selection makes no sense there.
    const items =
      menu.open && menu.mode === 'convert'
        ? SLASH_ITEMS.filter((item) => item.convertible)
        : SLASH_ITEMS;
    if (!menu.open) return items;
    // Combobox-style ranked fuzzy matching, language-agnostic in both
    // directions (English ↔ Korean keywords, wrong-IME input) — the same
    // behavior as the command palette.
    return filterSlashItems(items, menu.query);
  }, [menu]);

  // Re-ranking puts the best match first — follow the highlight along, like
  // the command palette does on every query change.
  const menuQuery = menu.open ? menu.query : '';
  useEffect(() => {
    setActiveIndex(0);
  }, [menuQuery]);

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
    if (!menu.open || menu.stage !== 'list') return;
    const safeIndex = Math.min(activeIndex, filteredItems.length - 1);
    const node = itemRefs.current[safeIndex];
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filteredItems, menu]);

  // Focus the image URL input as soon as the image stage mounts.
  useLayoutEffect(() => {
    if (!menu.open || menu.stage !== 'image-url') return;
    imageInputRef.current?.focus();
    imageInputRef.current?.select();
  }, [menu]);

  // Focus the convert-mode filter input on open so the user can type a
  // format name immediately (combobox behavior) without touching the doc.
  const convertFilterMounted = menu.open && menu.stage === 'list' && menu.mode === 'convert';
  useLayoutEffect(() => {
    if (!convertFilterMounted) return;
    filterInputRef.current?.focus();
  }, [convertFilterMounted]);

  // Flip the menu above the caret when there isn't enough room below — keeps
  // the dropdown from being clipped near the bottom of the viewport. Item
  // order is preserved; only the box's anchor side changes.
  useLayoutEffect(() => {
    if (!menu.open) {
      setPlacement('below');
      return;
    }
    const menuEl = menuRef.current;
    if (!menuEl) return;
    const height = menuEl.offsetHeight;
    if (height <= 0) return;
    const viewportHeight =
      typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const spaceBelow = viewportHeight - menu.cursorBottom - MENU_GUTTER - VIEWPORT_MARGIN;
    const spaceAbove = menu.cursorTop - MENU_GUTTER - VIEWPORT_MARGIN;
    let next: Placement;
    if (height <= spaceBelow) {
      next = 'below';
    } else if (height <= spaceAbove) {
      next = 'above';
    } else {
      next = spaceAbove > spaceBelow ? 'above' : 'below';
    }
    setPlacement((prev) => (prev === next ? prev : next));
  }, [menu, filteredItems]);

  // Watch editor transactions and recompute menu state. Selection / update
  // events refresh the query and caret coords; scroll / resize re-anchor the
  // popup to the slash character so it tracks the editor surface instead of
  // floating away when the user scrolls past it.
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

    // A convert-mode menu is anchored to the user's selection, not to typed
    // slash text — selection-shaped refreshes must leave it alone (clicks
    // elsewhere close it via the outside-pointer handler instead).
    const keepSpecialMenu = (prev: MenuState): MenuState =>
      prev.open && (prev.stage === 'image-url' || prev.mode === 'convert')
        ? prev
        : { open: false };

    const update = () => {
      const { state } = editor;
      const { from, to, empty } = state.selection;
      if (!empty || from !== to) {
        setMenu(keepSpecialMenu);
        return;
      }

      const $from = state.selection.$from;
      const blockStart = $from.start($from.depth);
      const textBefore = state.doc.textBetween(blockStart, from, '\n', ' ');
      // Match slash commands only at the start of a block (allowing leading
      // indentation). API routes such as "DELETE /api/..." commonly contain
      // slashes after ordinary text and must remain plain document content.
      const match = textBefore.match(/^(\s*)\/([^\s/]*)$/);
      if (!match) {
        setMenu(keepSpecialMenu);
        return;
      }

      const query = match[2] ?? '';
      const leadingWhitespace = match[1]?.length ?? 0;
      const matchStart = blockStart + leadingWhitespace;
      // Sanity: matchStart must point at the slash character.
      if (matchStart < blockStart || textBefore[leadingWhitespace] !== '/') {
        setMenu(keepSpecialMenu);
        return;
      }

      let coords: { top: number; bottom: number; left: number; right: number };
      try {
        coords = editor.view.coordsAtPos(matchStart);
      } catch {
        setMenu(keepSpecialMenu);
        return;
      }

      setMenu((prev) => {
        // Preserve the image-url stage across selection updates — those updates
        // fire as the user types in the URL input, and we don't want them to
        // bounce the menu back to the command list.
        if (prev.open && prev.stage === 'image-url') {
          return {
            ...prev,
            cursorTop: coords.top,
            cursorBottom: coords.bottom,
            left: coords.left,
          };
        }
        // An open Turn-into menu must not morph into the insert list just
        // because the caret happens to sit after literal "/text".
        if (prev.open && prev.mode === 'convert') {
          return prev;
        }
        return {
          open: true,
          stage: 'list',
          mode: 'insert',
          query,
          from: matchStart,
          to: from,
          cursorTop: coords.top,
          cursorBottom: coords.bottom,
          left: coords.left,
        };
      });
    };

    // A document change while the Turn-into menu is open means the user typed
    // over the selection — the conversion target is gone, so dismiss first.
    const onDocUpdate = () => {
      setMenu((prev) => (prev.open && prev.mode === 'convert' ? { open: false } : prev));
      update();
    };

    // Lightweight reposition — only updates coords when the menu is already
    // open. Used by scroll / resize so we don't accidentally re-open a menu
    // the user just dismissed, and so a scroll inside an empty doc doesn't
    // flash the menu on.
    const reposition = () => {
      setMenu((prev) => {
        if (!prev.open) return prev;
        try {
          const coords = editor.view.coordsAtPos(prev.from);
          return {
            ...prev,
            cursorTop: coords.top,
            cursorBottom: coords.bottom,
            left: coords.left,
          };
        } catch {
          return prev;
        }
      });
    };

    editor.on('selectionUpdate', update);
    editor.on('update', onDocUpdate);
    // Convert mode moves focus into the menu's own filter input, which blurs
    // the editor — that must not dismiss the menu. Outside clicks still
    // close it via the document-level pointer handler.
    const handleBlur = () =>
      setMenu((prev) => (prev.open && prev.mode === 'convert' ? prev : { open: false }));
    editor.on('blur', handleBlur);
    window.addEventListener('resize', reposition);
    // Capture-phase scroll listens to inner scroll containers (the WYSIWYG
    // editor pane has `overflow: auto`, so its scroll never bubbles to window
    // — only the capture phase sees it).
    window.addEventListener('scroll', reposition, true);

    // External "open the slash menu" trigger (Mod+/, the command palette,
    // etc.). 'insert' behaves as if the user had typed a slash at the caret —
    // from === to means `runItem`'s `deleteRange` is a no-op. 'convert' opens
    // the Turn-into list over the current selection (or the caret's line);
    // it refuses to open when the selection touches a table/image/divider,
    // which cannot be reformatted.
    const unsubscribeOpenAtCursor = subscribeEditorEvent('slash:open-at-cursor', (payload) => {
      const mode: MenuMode = payload.mode ?? 'insert';
      const { state } = editor;
      const { from, to, empty } = state.selection;
      if (mode === 'insert' && !empty) return;
      if (mode === 'convert' && !selectionSupportsConvert(editor)) return;
      let coords: { top: number; bottom: number; left: number; right: number };
      try {
        coords = editor.view.coordsAtPos(from);
      } catch {
        return;
      }
      setMenu({
        open: true,
        stage: 'list',
        mode,
        query: '',
        from,
        to: mode === 'convert' ? to : from,
        cursorTop: coords.top,
        cursorBottom: coords.bottom,
        left: coords.left,
      });
    });

    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', onDocUpdate);
      editor.off('blur', handleBlur);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      unsubscribeOpenAtCursor();
    };
  }, [editor, enabled]);

  // Shared list-navigation keys: the insert path listens on the editor DOM
  // (typing continues into the document), the convert path on the menu's own
  // filter input. Returns true when the key was consumed.
  const handleListNavigationKey = (event: {
    key: string;
    isComposing?: boolean;
    preventDefault: () => void;
  }): boolean => {
    if (event.isComposing || event.key === 'Process') return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredItems.length === 0 ? 0 : (current + 1) % filteredItems.length,
      );
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredItems.length === 0
          ? 0
          : (current - 1 + filteredItems.length) % filteredItems.length,
      );
      return true;
    }
    if (event.key === 'Enter') {
      if (filteredItems.length === 0) {
        setMenu({ open: false });
        return true;
      }
      event.preventDefault();
      runItem(filteredItems[Math.min(activeIndex, filteredItems.length - 1)]);
      return true;
    }
    if (event.key === 'Tab') {
      if (filteredItems.length === 0) return false;
      event.preventDefault();
      runItem(filteredItems[Math.min(activeIndex, filteredItems.length - 1)]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu({ open: false });
      editor?.commands?.focus?.();
      return true;
    }
    return false;
  };

  // Keyboard navigation lives on the editor DOM so it runs ahead of Tiptap's
  // own keymap and we can swallow arrows/Enter/Escape while open. The image
  // URL sub-stage and the convert-mode filter input own their keys via their
  // onKeyDown handlers, so this listener only covers the insert-mode list.
  useEffect(() => {
    if (!editor || !enabled || !menu.open || menu.stage !== 'list') return;
    if (menu.mode === 'convert') return;
    const dom = editor.view.dom as HTMLElement;

    const onKeyDown = (event: KeyboardEvent) => {
      handleListNavigationKey(event);
    };

    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, menu, filteredItems, activeIndex]);

  // Close on outside click. Scrolling repositions (see the main effect) so a
  // separate close-on-scroll path would just double-close — leave it out.
  useEffect(() => {
    if (!menu.open) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenu({ open: false });
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [menu.open]);

  const beginImagePrompt = () => {
    setImageUrl('https://');
    setMenu((prev) => (prev.open ? { ...prev, stage: 'image-url' } : prev));
  };

  const commitImage = () => {
    if (!editor || !menu.open) return;
    const trimmed = imageUrl.trim();
    const { from, to } = menu;
    setMenu({ open: false });
    setImageUrl('');
    if (!trimmed || trimmed === 'https://') {
      // Drop the slash-command text so the user doesn't end up with a
      // stranded "/image" in their document when they bail on the URL.
      editor.chain().focus().deleteRange({ from, to }).run();
      return;
    }
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .setImage({ src: trimmed })
      .run();
  };

  const cancelImagePrompt = () => {
    setMenu({ open: false });
    setImageUrl('');
    editor?.commands.focus();
  };

  // Native file picker → Rust copies the file into the document's asset
  // folder → insert the returned doc-relative src. The menu closes before
  // the (modal) dialog opens; the captured from/to still point at the typed
  // "/image" text because the dialog blocks any further edits.
  const pickImageFile = async (range: { from: number; to: number }) => {
    if (!editor) return;
    let selected: unknown;
    try {
      selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Image', extensions: IMAGE_FILE_EXTENSIONS }],
      });
    } catch {
      selected = null;
    }
    if (typeof selected !== 'string') {
      editor.chain().focus().deleteRange(range).run();
      return;
    }
    let src = selected;
    try {
      src = await importImageAsset(selected);
    } catch {
      // Unsaved document — no directory to be relative to. The absolute
      // path still renders through the Tauri asset protocol.
    }
    editor.chain().focus().deleteRange(range).setImage({ src }).run();
  };

  const runItem = (item: SlashItem | undefined) => {
    if (!item || !editor || !menu.open) return;
    if (item.kind === 'pick-image') {
      const { from, to } = menu;
      setMenu({ open: false });
      void pickImageFile({ from, to });
      return;
    }
    if (item.kind === 'prompt-image') {
      beginImagePrompt();
      return;
    }
    const { from, to, mode } = menu;
    setMenu({ open: false });
    if (mode !== 'convert') {
      // Insert mode: drop the typed "/query" text before running the command.
      // Convert mode must NOT delete anything — from/to span the user's own
      // selection, which the command reformats in place.
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .run();
    }
    item.run?.(editor);
  };

  if (!menu.open) return null;

  const portalTarget = typeof document === 'undefined' ? null : document.body;
  if (!portalTarget) return null;

  const viewportHeight =
    typeof window === 'undefined' ? 0 : window.innerHeight;
  const positionStyle: CSSProperties =
    placement === 'above'
      ? { bottom: viewportHeight - menu.cursorTop + MENU_GUTTER, left: menu.left }
      : { top: menu.cursorBottom + MENU_GUTTER, left: menu.left };

  const handleImageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitImage();
  };

  const handleImageInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelImagePrompt();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menu.mode === 'convert' ? 'Turn into' : 'Insert block'}
      data-testid="slash-command-menu"
      data-placement={placement}
      data-stage={menu.stage}
      className="slash-command-menu"
      style={positionStyle}
      onMouseDown={(event) => {
        // Keep the editor selection while clicking menu items. The menu's own
        // inputs (image URL, convert-mode filter) must still receive clicks.
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
      }}
    >
      {menu.stage === 'list' && menu.mode === 'convert' ? (
        <input
          ref={filterInputRef}
          type="text"
          className="slash-command-filter-input"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-label="Filter block formats"
          data-testid="slash-command-filter-input"
          placeholder="Turn into…"
          value={menu.query}
          onChange={(event) => {
            const value = event.target.value;
            setMenu((prev) => (prev.open ? { ...prev, query: value } : prev));
          }}
          onKeyDown={(event) => {
            handleListNavigationKey(event);
          }}
          spellCheck={false}
          autoComplete="off"
        />
      ) : null}
      {menu.stage === 'image-url' ? (
        <form
          className="slash-command-image-form"
          data-testid="slash-command-image-form"
          onSubmit={handleImageSubmit}
        >
          <input
            ref={imageInputRef}
            type="url"
            className="slash-command-image-input"
            aria-label="Image URL"
            placeholder="https://"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            onKeyDown={handleImageInputKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="slash-command-image-actions">
            <button
              type="button"
              className="slash-command-image-button"
              onClick={cancelImagePrompt}
            >
              Cancel
            </button>
            <button type="submit" className="slash-command-image-button is-primary">
              Insert
            </button>
          </div>
        </form>
      ) : filteredItems.length === 0 ? (
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
