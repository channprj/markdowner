import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

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
  localDraft: string;
  activeDocumentName: string | null;
  editorContent: ReactNode;
  sourceEditor: ReactNode;
  splitViewPreview: ReactNode;
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
  localDraft,
  activeDocumentName,
  editorContent,
  sourceEditor,
  splitViewPreview,
}: EditorAreaProps) {
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
          </Empty>
        ) : null}

        {activeDocumentOpen && currentMode === 'Wysiwyg' ? (
          <div className="markdown-surface min-h-0 flex-1 overflow-auto px-8 py-6">
            {editorContent}
          </div>
        ) : null}

        {activeDocumentOpen && currentMode === 'Editor' ? (
          <div className="min-h-0 flex-1 overflow-auto">
            {sourceEditor}
          </div>
        ) : null}

        {activeDocumentOpen && currentMode === 'SplitView' ? (
          <div className="flex min-h-0 flex-1 divide-x divide-border">
            <div className="flex-1 overflow-auto">
              {sourceEditor}
            </div>
            <div className="flex-1 overflow-auto bg-background">
              {splitViewPreview}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
