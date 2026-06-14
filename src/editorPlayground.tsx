/**
 * Dev-only playground that mounts the WYSIWYG editor with the exact same
 * extension set + editorProps + floating chrome as App.tsx, but WITHOUT any
 * Tauri dependency. Served at /playground.html so the editor can be driven in
 * a regular browser for manual + automated QA (the full app crashes in a
 * plain browser because it calls Tauri commands during bootstrap).
 *
 * Not bundled into the production app — playground.html is a separate Vite
 * entry that only the dev server / explicit QA builds serve.
 */
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRef } from 'react';
import ReactDOM from 'react-dom/client';

import { createCodeBlockExtension } from '@/components/wysiwyg/codeBlockExtension';
import { ImeDebugOverlay } from '@/components/wysiwyg/ImeDebugOverlay';
import { MarkdownLinkInputRule } from '@/components/wysiwyg/markdownLinkInputRule';
import { PreventTableHoverSelection } from '@/components/wysiwyg/preventTableHoverSelection';
import { TableArrowNavigation } from '@/components/wysiwyg/tableArrowNavigation';
import { WysiwygEditorChrome } from '@/shell/WysiwygEditorChrome';
import {
  shouldSuppressDuplicateImeTextInput,
  shouldSuppressSyntheticImeEnter,
} from '@/lib/wysiwygKeyboard';
import { WYSIWYG_LINK_OPTIONS } from '@/lib/wysiwygLinkOptions';
import './styles.css';

const MARKDOWN_CONTENT_SCOPE_CLASS = 'markdown-content-scope';

function Playground() {
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const pendingEnterAfterCompositionRef = useRef(false);
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: WYSIWYG_LINK_OPTIONS, codeBlock: false }),
      createCodeBlockExtension(),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      PreventTableHoverSelection,
      TableArrowNavigation,
      TaskList,
      TaskItem.configure({ nested: true }),
      MarkdownLinkInputRule,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content:
      '# Playground\n\nType here. Test: a table, a [link](https://example.com), and Korean 한글 입력.\n',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: `editor-surface tiptap-surface ${MARKDOWN_CONTENT_SCOPE_CLASS}`,
      },
      handleKeyDown: (view: any, event: KeyboardEvent) => {
        if (
          shouldSuppressSyntheticImeEnter(event, {
            isComposing: isComposingRef.current,
            viewComposing: (view as { composing?: boolean }).composing,
            lastCompositionEndAt: lastCompositionEndAtRef.current,
          })
        ) {
          return true;
        }
        return false;
      },
      handleTextInput: (view: any, from: number, to: number, text: string) => {
        if (
          shouldSuppressDuplicateImeTextInput({
            from,
            to,
            text,
            isComposing: isComposingRef.current,
            lastCompositionEndAt: lastCompositionEndAtRef.current,
            textBetween: view.state.doc.textBetween.bind(view.state.doc),
          })
        ) {
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        keydown: (view: any, event: Event) => {
          const ke = event as KeyboardEvent;
          if (
            ke.key === 'Enter' &&
            !ke.shiftKey &&
            !ke.metaKey &&
            !ke.ctrlKey &&
            !ke.altKey &&
            (ke.isComposing ||
              (view as { composing?: boolean }).composing ||
              isComposingRef.current)
          ) {
            pendingEnterAfterCompositionRef.current = true;
          }
          return false;
        },
        beforeinput: (_view: any, event: Event) => {
          const ie = event as InputEvent;
          if (
            ie.isComposing ||
            ie.inputType === 'insertCompositionText' ||
            (_view as { composing?: boolean }).composing
          ) {
            isComposingRef.current = true;
          }
          return false;
        },
        compositionstart: () => {
          isComposingRef.current = true;
          return false;
        },
        compositionend: (_view: any, event: Event) => {
          isComposingRef.current = false;
          lastCompositionEndAtRef.current = Date.now();
          if (pendingEnterAfterCompositionRef.current) {
            pendingEnterAfterCompositionRef.current = false;
            window.setTimeout(() => {
              const ed = editorRef.current;
              if (!ed) return;
              if (isComposingRef.current) return;
              ed.chain()
                .focus()
                .command(({ commands }) =>
                  commands.first([
                    () => commands.newlineInCode(),
                    () => commands.createParagraphNear(),
                    () => commands.liftEmptyBlock(),
                    () => commands.splitBlock(),
                  ]),
                )
                .run();
            }, 80);
          }
          return false;
        },
        compositioncancel: () => {
          isComposingRef.current = false;
          pendingEnterAfterCompositionRef.current = false;
          lastCompositionEndAtRef.current = Date.now();
          return false;
        },
      },
    },
    immediatelyRender: false,
  });

  editorRef.current = editor;

  // Expose to window so automated QA can read editor state / markdown.
  if (typeof window !== 'undefined') {
    (window as unknown as { __editor?: typeof editor }).__editor = editor;
  }

  return (
    <div
      className="editor-pane editor-pane-wysiwyg markdown-surface notion-wysiwyg-surface"
      data-mode="Wysiwyg"
      style={{ height: '100vh', overflow: 'auto', padding: '2rem' }}
    >
      <div className="notion-editor-shell">
        <div className="notion-editor-content">
          <WysiwygEditorChrome editor={editor} enabled />
        </div>
      </div>
      <ImeDebugOverlay />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Playground />);
