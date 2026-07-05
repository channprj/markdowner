export type WorkspaceTreeFileNode = {
  kind: 'file';
  key: string;
  path: string;
  name: string;
  relativePath: string;
};

export type WorkspaceTreeFolderNode = {
  kind: 'folder';
  key: string;
  name: string;
  children: WorkspaceTreeNode[];
};

export type WorkspaceTreeNode = WorkspaceTreeFileNode | WorkspaceTreeFolderNode;

export type WorkspaceTreeViewState = {
  tree: WorkspaceTreeNode[];
  filteredTree: WorkspaceTreeNode[];
  filtering: boolean;
  signature: string;
};

export function displayFileName(path: string): string {
  const normalizedPath = normalizeDisplayPath(path);
  const segments = normalizedPath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function displayWorkspacePath(path: string, rootDir: string | null): string {
  const normalizedPath = normalizeDisplayPath(path);
  if (!rootDir) {
    return normalizedPath;
  }

  const normalizedRoot = normalizeDisplayPath(rootDir).replace(/\/+$/, '');
  const pathPrefix = `${normalizedRoot}/`;

  if (normalizedPath.toLowerCase().startsWith(pathPrefix.toLowerCase())) {
    return normalizedPath.slice(pathPrefix.length);
  }

  return normalizedPath;
}

export function buildWorkspaceTree(
  paths: readonly string[],
  rootDir: string | null,
): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];

  for (const path of paths) {
    const relativePath = displayWorkspacePath(path, rootDir);
    const segments = normalizeDisplayPath(relativePath).split('/').filter(Boolean);
    let level = root;
    let folderKey = '';

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? '';
      const isFile = index === segments.length - 1;

      if (isFile) {
        level.push({
          kind: 'file',
          key: path,
          path,
          name: segment || displayFileName(path),
          relativePath,
        });
        continue;
      }

      folderKey = folderKey ? `${folderKey}/${segment}` : segment;

      let folderNode = level.find(
        (node): node is WorkspaceTreeFolderNode =>
          node.kind === 'folder' && node.key === folderKey,
      );

      if (!folderNode) {
        folderNode = {
          kind: 'folder',
          key: folderKey,
          name: segment,
          children: [],
        };
        level.push(folderNode);
      }

      level = folderNode.children;
    }
  }

  return root;
}

export function filterWorkspaceTree(
  nodes: WorkspaceTreeNode[],
  query: string,
): WorkspaceTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return nodes;
  }

  const filteredNodes: WorkspaceTreeNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'file') {
      const haystack = `${node.name}\u0000${node.relativePath}`.toLowerCase();
      if (fuzzyMatch(haystack, normalizedQuery)) {
        filteredNodes.push(node);
      }
      continue;
    }

    const filteredChildren = filterWorkspaceTree(node.children, normalizedQuery);
    if (filteredChildren.length > 0) {
      filteredNodes.push({
        ...node,
        children: filteredChildren,
      });
    }
  }

  return filteredNodes;
}

export function buildWorkspaceTreeSignature(
  paths: readonly string[],
  rootDir: string | null,
): string {
  return `${rootDir ?? ''}\u0000${paths.join('\u0000')}`;
}

export function resolveWorkspaceTreeViewState({
  paths,
  rootDir,
  filter,
}: {
  paths: readonly string[];
  rootDir: string | null;
  filter: string;
}): WorkspaceTreeViewState {
  const tree = buildWorkspaceTree(paths, rootDir);
  const filtering = filter.trim().length > 0;

  return {
    tree,
    filteredTree: filterWorkspaceTree(tree, filter),
    filtering,
    signature: buildWorkspaceTreeSignature(paths, rootDir),
  };
}

export function collectWorkspaceFolderKeys(nodes: readonly WorkspaceTreeNode[]): string[] {
  const folderKeys: string[] = [];
  appendWorkspaceFolderKeys(nodes, folderKeys);
  return folderKeys;
}

export function countVisibleWorkspaceTreeRows({
  nodes,
  collapsedFolderKeys,
  filtering,
}: {
  nodes: readonly WorkspaceTreeNode[];
  collapsedFolderKeys: readonly string[];
  filtering: boolean;
}): number {
  let count = 0;
  const collapsedFolders = new Set(collapsedFolderKeys);

  const appendVisibleRows = (treeNodes: readonly WorkspaceTreeNode[]) => {
    for (const node of treeNodes) {
      count += 1;

      if (node.kind === 'folder' && (filtering || !collapsedFolders.has(node.key))) {
        appendVisibleRows(node.children);
      }
    }
  };

  appendVisibleRows(nodes);
  return count;
}

export function toggleWorkspaceFolderKey(
  collapsedFolderKeys: readonly string[],
  key: string,
): string[] {
  return collapsedFolderKeys.includes(key)
    ? collapsedFolderKeys.filter((entry) => entry !== key)
    : [...collapsedFolderKeys, key];
}

export function pruneCollapsedWorkspaceFolderKeys(
  collapsedFolderKeys: readonly string[],
  nodes: readonly WorkspaceTreeNode[],
): string[] {
  const folderKeys = new Set(collectWorkspaceFolderKeys(nodes));
  return collapsedFolderKeys.filter((key) => folderKeys.has(key));
}

function normalizeDisplayPath(path: string): string {
  return path.replace(/\\/g, '/');
}

// VS Code-style subsequence ("full fuzzy") match: every character of
// `needle` must appear in `haystack` in the same order, not necessarily
// adjacent. Returns true for an empty query so callers treat "no filter"
// naturally.
function fuzzyMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  let cursor = 0;
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack.charCodeAt(i) === needle.charCodeAt(cursor)) {
      cursor += 1;
      if (cursor === needle.length) return true;
    }
  }
  return false;
}

function appendWorkspaceFolderKeys(
  nodes: readonly WorkspaceTreeNode[],
  folderKeys: string[],
): void {
  for (const node of nodes) {
    if (node.kind !== 'folder') {
      continue;
    }

    folderKeys.push(node.key);
    appendWorkspaceFolderKeys(node.children, folderKeys);
  }
}
