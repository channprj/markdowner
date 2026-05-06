interface StatusBarProps {
  mode: string;
  theme: string;
  busy?: boolean;
  isDirty?: boolean | null;
  documentName?: string | null;
  documentPath?: string | null;
  workspaceName?: string | null;
  activeDocumentLabel?: string | null;
  cursorLine?: number | null;
  cursorColumn?: number | null;
  wordCount?: number | null;
  characterCount?: number | null;
  readingTimeMinutes?: number | null;
}

export function StatusBar({
  mode,
  theme,
  busy = false,
  isDirty,
  documentName,
  documentPath,
  workspaceName,
  activeDocumentLabel,
  cursorLine,
  cursorColumn,
  wordCount,
  characterCount,
  readingTimeMinutes,
}: StatusBarProps) {
  const showCursorPosition =
    typeof cursorLine === 'number' && typeof cursorColumn === 'number';
  const showDocumentStats =
    typeof wordCount === 'number' && typeof characterCount === 'number';
  const showReadingTime = typeof readingTimeMinutes === 'number' && readingTimeMinutes > 0;
  const showDirtyStatus = typeof isDirty === 'boolean';

  return (
    <footer className="flex h-7 min-w-0 items-center justify-between gap-3 border-t border-border bg-muted/50 px-2 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {busy ? (
          <span
            role="status"
            aria-label="Working"
            className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[0.68rem] text-foreground"
          >
            Working…
          </span>
        ) : null}
        {documentName ? (
          <span className="truncate font-medium text-foreground" title={documentPath ?? undefined}>
            {documentName}
          </span>
        ) : null}
        {showDirtyStatus ? (
          <span className="shrink-0" title="Save status">
            {isDirty ? 'Unsaved Changes' : 'Saved'}
          </span>
        ) : null}
        {activeDocumentLabel && activeDocumentLabel !== documentName ? (
          <span className="hidden truncate min-[520px]:inline" title={activeDocumentLabel}>
            {activeDocumentLabel}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 overflow-hidden">
        {showDocumentStats ? (
          <span className="hidden min-[760px]:inline" title="Document statistics">
            {wordCount} {wordCount === 1 ? 'word' : 'words'} · {characterCount} {characterCount === 1 ? 'char' : 'chars'}
            {showReadingTime ? ` · ~${readingTimeMinutes} min read` : ''}
          </span>
        ) : null}
        <span className="hidden min-[440px]:inline" title="Active editor mode">{mode}</span>
        {showCursorPosition ? (
          <span className="hidden min-[620px]:inline" title="Cursor position">
            Ln {cursorLine}, Col {cursorColumn}
          </span>
        ) : null}
        <span className="hidden min-[520px]:inline" title="Active theme">{theme}</span>
        {workspaceName ? (
          <span className="hidden min-[680px]:inline" title={`Workspace: ${workspaceName}`}>
            {workspaceName}
          </span>
        ) : null}
      </div>
    </footer>
  );
}
