import { displayFileName, displayWorkspacePath } from './workspaceTree';

export type QuickOpenItemKind = 'workspace' | 'recent';

export type QuickOpenFileItem = {
  path: string;
  name: string;
  relativePath: string;
  kind: QuickOpenItemKind;
};

type QuickOpenSnapshot = {
  workspaceDocuments: readonly string[];
  recentDocuments: readonly string[];
  rootDir: string | null;
};

export function buildQuickOpenItems(snapshot: QuickOpenSnapshot): QuickOpenFileItem[] {
  const seen = new Set<string>();
  const items: QuickOpenFileItem[] = [];

  const accumulate = (paths: readonly string[], kind: QuickOpenItemKind) => {
    for (const path of paths) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      items.push({
        path,
        name: displayFileName(path),
        relativePath: displayWorkspacePath(path, snapshot.rootDir),
        kind,
      });
    }
  };

  accumulate(snapshot.workspaceDocuments, 'workspace');
  accumulate(snapshot.recentDocuments, 'recent');
  return items;
}
