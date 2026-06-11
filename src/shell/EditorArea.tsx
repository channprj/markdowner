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
import { Minimap } from './Minimap';
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
  findReplaceBar?: ReactNode;
  editorContent: ReactNode;
  sourceEditor: ReactNode;
  splitViewPreview: ReactNode;
  splitSourceRef?: Ref<HTMLDivElement>;
  splitPreviewRef?: Ref<HTMLDivElement>;
  onSplitSourceScroll?: UIEventHandler<HTMLDivElement>;
  onSplitPreviewScroll?: UIEventHandler<HTMLDivElement>;
  onSplitPreviewClick?: MouseEventHandler<HTMLDivElement>;
  onSourceSurfaceMouseDown?: MouseEventHandler<HTMLDivElement>;
  onWysiwygSurfaceMouseDown?: MouseEventHandler<HTMLDivElement>;
  /**
   * Synchronous draft (no deferred lag) used for places that must reflect the
   * latest keystroke immediately — currently the "Disk vs local" external
   * change comparison. `localDraft` itself is allowed to lag a frame so the
   * minimap can keep up with large documents without blocking cursor input.
   */
  syncLocalDraft?: string;
  fontSize?: number;
  /** Unitless line-height multiplier; applied so CodeMirror + ProseMirror match. */
  lineHeight?: number;
  fontFamily?: string;
  focusModeEnabled?: boolean;
  typewriterModeEnabled?: boolean;
  lineWrap?: boolean;
  wrapColumn?: number;
  /** Show a vertical guide line at the wrap column (fixed-column mode only). */
  showWrapLine?: boolean;
  /** When true, an overlay minimap is rendered against the editor surface. */
  minimapEnabled?: boolean;
  /** The scrollable element the minimap mirrors. Typically the active editor pane. */
  minimapScrollEl?: HTMLElement | null;
  /** Controls cell padding/font in WYSIWYG + preview markdown tables. */
  tableDensity?: 'compact' | 'normal';
  tableViewMode?: 'normal' | 'inline';
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
  findReplaceBar,
  editorContent,
  sourceEditor,
  splitViewPreview,
  splitSourceRef,
  splitPreviewRef,
  onSplitSourceScroll,
  onSplitPreviewScroll,
  onSplitPreviewClick,
  onSourceSurfaceMouseDown,
  onWysiwygSurfaceMouseDown,
  syncLocalDraft,
  fontSize,
  lineHeight,
  fontFamily,
  focusModeEnabled = false,
  typewriterModeEnabled = false,
  lineWrap = true,
  wrapColumn,
  showWrapLine = true,
  minimapEnabled = false,
  minimapScrollEl = null,
  tableDensity = 'compact',
  tableViewMode = 'normal',
}: EditorAreaProps) {
  // Cast the style record so we can carry our custom property
  // (`--editor-wrap-column`) without TypeScript complaining about an
  // unknown CSS field.
  const editorSurfaceStyle: CSSProperties & Record<string, string | number> = {};
  if (fontSize && Number.isFinite(fontSize) && fontSize > 0) {
    editorSurfaceStyle.fontSize = `${fontSize}px`;
  }
  if (lineHeight && Number.isFinite(lineHeight) && lineHeight > 0) {
    // Unitless line-height — CodeMirror and ProseMirror both inherit; rendered
    // line-height becomes `fontSize * lineHeight`, so ⌘+/⌘- on the font alone
    // keeps the leading proportional.
    editorSurfaceStyle.lineHeight = lineHeight;
    editorSurfaceStyle['--editor-line-height'] = String(lineHeight);
  }
  if (fontFamily && fontFamily.trim().length > 0) {
    editorSurfaceStyle.fontFamily = fontFamily;
  }
  const columnMode = lineWrap && Boolean(wrapColumn) && Number.isFinite(wrapColumn) && wrapColumn! > 0;
  if (columnMode) {
    editorSurfaceStyle['--editor-wrap-column'] = `${wrapColumn}ch`;
  }
  const lineWrapAttribute = lineWrap ? 'true' : 'false';
  // Present only in fixed-column mode (wrap on + column > 0). This single
  // attribute gates both the text-width cap and the wrap guide line in CSS;
  // its absence means "wrap to window" (column 0) or "no wrap" (lineWrap off).
  const wrapColumnAttribute = columnMode ? String(wrapColumn) : undefined;
  const wrapLineAttribute = showWrapLine ? 'on' : 'off';
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

      <section
        className="relative flex min-h-0 flex-1 flex-col bg-background"
        data-mode={currentMode}
        data-minimap={minimapEnabled && activeDocumentOpen ? 'on' : 'off'}
        data-table-density={tableDensity}
        data-table-view={tableViewMode}
      >
        {/* Floating notification layer. Alerts overlay the editor surface
            (below the find/replace bar) instead of participating in the flex
            column, so showing/hiding one never shifts the editor content
            (autosave-tick banners used to jolt the view). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col gap-2 p-4">
          {errorMessage ? (
            <Alert variant="destructive" className="pointer-events-auto shadow-lg">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {externalChangeMessage ? (
            <Alert className="pointer-events-auto shadow-lg">
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
            <Alert className="pointer-events-auto shadow-lg">
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
                    {syncLocalDraft ?? localDraft}
                  </pre>
                </div>
              </div>
            </Alert>
          ) : null}
        </div>

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
          data-line-wrap={lineWrapAttribute}
          data-wrap-column={wrapColumnAttribute}
          data-wrap-line={wrapLineAttribute}
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
          onMouseDown={onSourceSurfaceMouseDown}
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
          data-line-wrap={lineWrapAttribute}
          data-wrap-column={wrapColumnAttribute}
          data-wrap-line={wrapLineAttribute}
          className={cn(
            'editor-pane editor-pane-wysiwyg markdown-surface notion-wysiwyg-surface min-h-0 overflow-auto',
            editorModeClassName,
            !(activeDocumentOpen && currentMode === 'Wysiwyg') && 'hidden',
            activeDocumentOpen && currentMode === 'Wysiwyg' && 'flex-1',
          )}
          onMouseDown={onWysiwygSurfaceMouseDown}
          style={editorSurfaceStyle}
          aria-hidden={!(activeDocumentOpen && currentMode === 'Wysiwyg')}
        >
          {activeDocumentOpen ? (
            <div
              data-testid="notion-editor-shell"
              className="notion-editor-shell"
            >
              <div className="notion-editor-content">
                {editorContent}
              </div>
            </div>
          ) : null}
        </div>

        {minimapEnabled && activeDocumentOpen ? (
          <Minimap text={localDraft} scrollEl={minimapScrollEl} />
        ) : null}
      </section>
    </main>
  );
}
