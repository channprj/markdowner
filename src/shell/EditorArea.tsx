import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import {
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
  type Ref,
  type UIEventHandler,
} from 'react';

export interface EditorAreaProps {
  busy: boolean;
  errorMessage: string | null;
  externalChangeMessage: string | null;
  showExternalChangeActions: boolean;
  externalCompareSource: string | null;
  activeDocumentOpen: boolean;
  currentMode: 'Editor' | 'Wysiwyg' | 'SplitView';
  onReloadActiveDocument: () => void;
  onKeepLocalChanges: () => void;
  onCompareExternalChanges: () => void;
  onHideComparison: () => void;
  onNewDocument?: () => void;
  onOpenDocument?: () => void;
  onOpenWorkspace?: () => void;
  localDraft: string;
  activeDocumentName: string | null;
  findReplaceBar?: ReactNode;
  editorContent: ReactNode;
  sourceEditor: ReactNode;
  splitViewPreview: ReactNode;
  splitSourceRef?: Ref<HTMLDivElement>;
  splitPreviewRef?: Ref<HTMLDivElement>;
  onSplitSourceScroll?: UIEventHandler<HTMLDivElement>;
  onSplitPreviewScroll?: UIEventHandler<HTMLDivElement>;
  onSplitPreviewClick?: MouseEventHandler<HTMLDivElement>;
  fontSize?: number;
  fontFamily?: string;
  focusModeEnabled?: boolean;
  typewriterModeEnabled?: boolean;
}

export function EditorArea({
  busy,
  errorMessage,
  externalChangeMessage,
  showExternalChangeActions,
  externalCompareSource,
  activeDocumentOpen,
  currentMode,
  onReloadActiveDocument,
  onKeepLocalChanges,
  onCompareExternalChanges,
  onHideComparison,
  onNewDocument,
  onOpenDocument,
  onOpenWorkspace,
  localDraft,
  activeDocumentName,
  findReplaceBar,
  editorContent,
  sourceEditor,
  splitViewPreview,
  splitSourceRef,
  splitPreviewRef,
  onSplitSourceScroll,
  onSplitPreviewScroll,
  onSplitPreviewClick,
  fontSize,
  fontFamily,
  focusModeEnabled = false,
  typewriterModeEnabled = false,
}: EditorAreaProps) {
  const editorSurfaceStyle: CSSProperties = {};
  if (fontSize && Number.isFinite(fontSize) && fontSize > 0) {
    editorSurfaceStyle.fontSize = `${fontSize}px`;
  }
  if (fontFamily && fontFamily.trim().length > 0) {
    editorSurfaceStyle.fontFamily = fontFamily;
  }
  const editorModeAttributes = {
    'data-focus-mode': String(focusModeEnabled),
    'data-typewriter-mode': String(typewriterModeEnabled),
  };
  const editorModeClassName = cn(
    focusModeEnabled && 'editor-focus-mode',
    typewriterModeEnabled && 'editor-typewriter-mode',
  );
  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-col">
      {findReplaceBar}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {externalChangeMessage ? (
        <Alert>
          <AlertTitle>External change detected</AlertTitle>
          <AlertDescription>{externalChangeMessage}</AlertDescription>
          {showExternalChangeActions ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onReloadActiveDocument}
              >
                Reload from disk
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onKeepLocalChanges}
              >
                Keep local
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onCompareExternalChanges}
              >
                Compare
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {externalCompareSource !== null ? (
        <Alert>
          <div className="flex items-center justify-between gap-2">
            <AlertTitle>Disk vs local</AlertTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onHideComparison}
            >
              Hide comparison
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Disk
              </h4>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {externalCompareSource}
              </pre>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Local
              </h4>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {localDraft}
              </pre>
            </div>
          </div>
        </Alert>
      ) : null}

      <section
        className="flex min-h-0 flex-1 flex-col bg-background"
        data-mode={currentMode}
      >
        {!activeDocumentOpen ? (
          <Empty className="flex-1 border-dashed">
            <EmptyHeader>
              <EmptyTitle>Start your next document</EmptyTitle>
              <EmptyDescription>
                Create a new draft or open a Markdown file to begin editing right away.
              </EmptyDescription>
            </EmptyHeader>
            {onNewDocument || onOpenDocument || onOpenWorkspace ? (
              <EmptyContent>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {onNewDocument ? (
                    <Button
                      size="sm"
                      onClick={onNewDocument}
                      disabled={busy}
                      title="New File (Cmd+N)"
                      aria-keyshortcuts="Meta+N Control+N"
                    >
                      New File
                    </Button>
                  ) : null}
                  {onOpenDocument ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenDocument}
                      disabled={busy}
                      title="Open File (Cmd+O)"
                      aria-keyshortcuts="Meta+O Control+O"
                    >
                      Open File…
                    </Button>
                  ) : null}
                  {onOpenWorkspace ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenWorkspace}
                      disabled={busy}
                      title="Open Workspace (Cmd+Shift+O)"
                      aria-keyshortcuts="Meta+Shift+O Control+Shift+O"
                    >
                      Open Workspace…
                    </Button>
                  ) : null}
                </div>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : null}

        {/* Persistent source pane. Visible in Editor (full width) and
            Split-view (left half). Hidden in Wysiwyg. Stays mounted at
            all times so CodeMirror's view state survives mode switches. */}
        <div
          ref={splitSourceRef}
          data-testid="editor-surface-source"
          {...editorModeAttributes}
          role="region"
          aria-label="Markdown source"
          className={cn(
            'editor-pane editor-pane-source min-h-0 overflow-hidden',
            editorModeClassName,
            !activeDocumentOpen && 'hidden',
            activeDocumentOpen && currentMode === 'Wysiwyg' && 'hidden',
            activeDocumentOpen && currentMode === 'Editor' && 'flex-1',
            activeDocumentOpen && currentMode === 'SplitView' && 'flex-1 border-r border-border',
          )}
          onScroll={onSplitSourceScroll}
          style={editorSurfaceStyle}
          aria-hidden={!activeDocumentOpen || currentMode === 'Wysiwyg'}
        >
          {sourceEditor}
        </div>

        {/* Persistent preview pane. Visible only in Split-view. */}
        <div
          ref={splitPreviewRef}
          data-testid="editor-surface-preview"
          {...editorModeAttributes}
          role="region"
          aria-label="Markdown preview"
          className={cn(
            'editor-pane editor-pane-preview min-h-0 overflow-auto bg-background',
            editorModeClassName,
            !(activeDocumentOpen && currentMode === 'SplitView') && 'hidden',
            activeDocumentOpen && currentMode === 'SplitView' && 'flex-1',
          )}
          onScroll={onSplitPreviewScroll}
          onClick={onSplitPreviewClick}
          style={editorSurfaceStyle}
          aria-hidden={!(activeDocumentOpen && currentMode === 'SplitView')}
        >
          {splitViewPreview}
        </div>

        {/* Persistent Wysiwyg surface. Visible only in Wysiwyg mode. */}
        <div
          data-testid="editor-surface-wysiwyg"
          {...editorModeAttributes}
          className={cn(
            'editor-pane editor-pane-wysiwyg markdown-surface min-h-0 overflow-auto px-8 py-6',
            editorModeClassName,
            !(activeDocumentOpen && currentMode === 'Wysiwyg') && 'hidden',
            activeDocumentOpen && currentMode === 'Wysiwyg' && 'flex-1',
          )}
          style={editorSurfaceStyle}
          aria-hidden={!(activeDocumentOpen && currentMode === 'Wysiwyg')}
        >
          {editorContent}
        </div>
      </section>
    </main>
  );
}
