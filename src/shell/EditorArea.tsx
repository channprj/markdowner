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
import { type CSSProperties, type ReactNode } from 'react';

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
  editorContent: ReactNode;
  sourceEditor: ReactNode;
  splitViewPreview: ReactNode;
  fontSize?: number;
  fontFamily?: string;
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
  editorContent,
  sourceEditor,
  splitViewPreview,
  fontSize,
  fontFamily,
}: EditorAreaProps) {
  const editorSurfaceStyle: CSSProperties = {};
  if (fontSize && Number.isFinite(fontSize) && fontSize > 0) {
    editorSurfaceStyle.fontSize = `${fontSize}px`;
  }
  if (fontFamily && fontFamily.trim().length > 0) {
    editorSurfaceStyle.fontFamily = fontFamily;
  }
  return (
    <main className="flex min-w-0 flex-col relative h-full">
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

      <section className="flex min-h-0 flex-1 flex-col bg-background">
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
                    >
                      Open Workspace…
                    </Button>
                  ) : null}
                </div>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : null}

        {activeDocumentOpen && currentMode === 'Wysiwyg' ? (
          <div
            data-testid="editor-surface-wysiwyg"
            className="markdown-surface min-h-0 flex-1 overflow-auto px-8 py-6"
            style={editorSurfaceStyle}
          >
            {editorContent}
          </div>
        ) : null}

        {activeDocumentOpen && currentMode === 'Editor' ? (
          <div
            data-testid="editor-surface-source"
            className="min-h-0 flex-1 overflow-auto"
            style={editorSurfaceStyle}
          >
            {sourceEditor}
          </div>
        ) : null}

        {activeDocumentOpen && currentMode === 'SplitView' ? (
          <div className="flex min-h-0 flex-1 divide-x divide-border">
            <div
              data-testid="editor-surface-source"
              className="flex-1 overflow-auto"
              style={editorSurfaceStyle}
            >
              {sourceEditor}
            </div>
            <div
              data-testid="editor-surface-preview"
              className="flex-1 overflow-auto bg-background"
              style={editorSurfaceStyle}
            >
              {splitViewPreview}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
