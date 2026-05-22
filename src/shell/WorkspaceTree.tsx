import { ChevronDown, ChevronRight, FileText, FolderOpen } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WorkspaceTreeNode } from '@/lib/workspaceTree';

type WorkspaceTreeProps = {
  nodes: readonly WorkspaceTreeNode[];
  activePath: string | null;
  collapsedKeys: readonly string[];
  filtering: boolean;
  onToggleFolder: (key: string) => void;
  onOpenFile: (path: string) => void;
};

export function WorkspaceTree({
  nodes,
  activePath,
  collapsedKeys,
  filtering,
  onToggleFolder,
  onOpenFile,
}: WorkspaceTreeProps) {
  return (
    <>
      {nodes.map((node) => (
        <WorkspaceTreeNodeView
          key={node.key}
          node={node}
          depth={0}
          activePath={activePath}
          collapsedKeys={collapsedKeys}
          filtering={filtering}
          onToggleFolder={onToggleFolder}
          onOpenFile={onOpenFile}
        />
      ))}
    </>
  );
}

type WorkspaceTreeNodeViewProps = Omit<WorkspaceTreeProps, 'nodes'> & {
  node: WorkspaceTreeNode;
  depth: number;
};

function WorkspaceTreeNodeView({
  node,
  depth,
  activePath,
  collapsedKeys,
  filtering,
  onToggleFolder,
  onOpenFile,
}: WorkspaceTreeNodeViewProps) {
  if (node.kind === 'folder') {
    const collapsed = !filtering && collapsedKeys.includes(node.key);

    return (
      <div className="flex flex-col">
        <button
          type="button"
          className="explorer-tree-row flex w-full items-center gap-1.5 text-left text-xs text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-expanded={!collapsed}
          data-explorer-row=""
          onClick={() => onToggleFolder(node.key)}
          style={{ paddingLeft: `${4 + depth * 12}px` }}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{node.name}</span>
        </button>
        {!collapsed ? (
          <div className="flex flex-col">
            {node.children.map((child) => (
              <WorkspaceTreeNodeView
                key={child.key}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                collapsedKeys={collapsedKeys}
                filtering={filtering}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const isActive = node.path === activePath;

  return (
    <button
      type="button"
      className={cn(
        'explorer-tree-row flex w-full items-center gap-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
        isActive && 'bg-accent text-accent-foreground',
      )}
      data-explorer-row=""
      onClick={() => onOpenFile(node.path)}
      style={{ paddingLeft: `${24 + depth * 12}px` }}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{node.name}</span>
      <span className="sr-only" aria-hidden="true">
        {node.relativePath}
      </span>
    </button>
  );
}
