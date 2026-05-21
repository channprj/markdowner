import type { ThemeKind } from './desktop';

export const WINDOW_TITLE = 'Markdowner';

type WindowTitleSnapshot = {
  activeDocumentDirty: boolean;
  activeDocumentName: string | null;
  activeDocumentSource: string | null;
};

const THEME_KIND_LABELS: Record<ThemeKind, string> = {
  BuiltInLight: 'Light',
  BuiltInDark: 'Dark',
  CustomCss: 'Custom',
};

export function formatThemeLabel(kind: ThemeKind): string {
  return THEME_KIND_LABELS[kind] ?? kind;
}

export function buildWindowTitle(snapshot: WindowTitleSnapshot): string {
  if (snapshot.activeDocumentSource === null || !snapshot.activeDocumentName) {
    return WINDOW_TITLE;
  }

  const prefix = snapshot.activeDocumentDirty ? '\u25cf ' : '';
  return `${prefix}${snapshot.activeDocumentName} \u2014 ${WINDOW_TITLE}`;
}
