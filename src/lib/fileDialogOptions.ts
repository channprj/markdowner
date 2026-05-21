export const MARKDOWN_FILE_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];

type OpenDialogSelection = string | string[] | null | undefined;

export function normalizeOpenDialogPaths(selection: OpenDialogSelection): string[] {
  if (selection === null || selection === undefined) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export function defaultMarkdownSavePath(
  activeDocumentPath: string | null | undefined,
  activeDocumentName: string | null | undefined,
): string {
  return activeDocumentPath ?? activeDocumentName ?? 'Untitled.md';
}
