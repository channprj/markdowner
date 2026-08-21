import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { localAgentStatuses } from '@/lib/desktop';
import type { LocalAgentExecutablePaths } from '@/lib/settings';

import type { LocalAgentKind, LocalAgentStatus } from './types';

export interface LocalAgentSettingsServices {
  listStatuses: (paths: LocalAgentExecutablePaths) => Promise<LocalAgentStatus[]>;
  selectExecutable: (kind: LocalAgentKind) => Promise<string | null>;
}

export interface LocalAgentSettingsProps {
  disclosureAccepted: boolean;
  onDisclosureAcceptedChange: (accepted: boolean) => void;
  executablePaths: LocalAgentExecutablePaths;
  onExecutablePathsChange: (paths: LocalAgentExecutablePaths) => void;
  services?: Partial<LocalAgentSettingsServices>;
}

const DEFAULT_SERVICES: LocalAgentSettingsServices = {
  listStatuses: localAgentStatuses,
  selectExecutable: async (kind) => {
    const agent = AGENTS.find((candidate) => candidate.kind === kind);
    const selected = await openDialog({
      directory: false,
      multiple: false,
      title: `Select ${agent?.label ?? kind} executable`,
    });
    return typeof selected === 'string' ? selected : null;
  },
};

const AGENTS: ReadonlyArray<{ kind: LocalAgentKind; label: string; mention: string }> = [
  { kind: 'claude', label: 'Claude Code', mention: '@claude' },
  { kind: 'codex', label: 'Codex', mention: '@codex' },
  { kind: 'opencode', label: 'OpenCode', mention: '@opencode' },
];

export function LocalAgentSettings({
  disclosureAccepted,
  onDisclosureAcceptedChange,
  executablePaths,
  onExecutablePathsChange,
  services = DEFAULT_SERVICES,
}: LocalAgentSettingsProps) {
  const [statuses, setStatuses] = useState<LocalAgentStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draftPaths, setDraftPaths] = useState(executablePaths);
  const refreshGeneration = useRef(0);
  const executablePathsRef = useRef(executablePaths);
  const dirtyPathsRef = useRef(new Set<LocalAgentKind>());
  const resolvedServices = { ...DEFAULT_SERVICES, ...services };

  useEffect(() => {
    return () => {
      refreshGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    executablePathsRef.current = executablePaths;
    setDraftPaths((current) => ({
      claude: dirtyPathsRef.current.has('claude') ? current.claude : executablePaths.claude,
      codex: dirtyPathsRef.current.has('codex') ? current.codex : executablePaths.codex,
      opencode: dirtyPathsRef.current.has('opencode')
        ? current.opencode
        : executablePaths.opencode,
    }));
  }, [executablePaths]);

  const refresh = async (paths = executablePathsRef.current) => {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    setLoading(true);
    setError('');
    try {
      const next = await resolvedServices.listStatuses(paths);
      if (refreshGeneration.current === generation) setStatuses(next);
    } catch {
      if (refreshGeneration.current === generation) {
        setError('Could not refresh local agent status.');
      }
    } finally {
      if (refreshGeneration.current === generation) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh(executablePathsRef.current);
  }, []);

  const persistExecutablePath = async (kind: LocalAgentKind, path: string) => {
    const trimmed = path.trim();
    dirtyPathsRef.current.delete(kind);
    setDraftPaths((current) => ({ ...current, [kind]: trimmed }));
    const nextPaths = { ...executablePathsRef.current, [kind]: trimmed };
    executablePathsRef.current = nextPaths;
    onExecutablePathsChange(nextPaths);
    await refresh(nextPaths);
  };

  const commitDraftExecutablePath = (kind: LocalAgentKind, path: string) => {
    if (!dirtyPathsRef.current.has(kind)) return;
    void persistExecutablePath(kind, path);
  };

  const browse = async (kind: LocalAgentKind) => {
    try {
      const selected = await resolvedServices.selectExecutable(kind);
      if (selected !== null) await persistExecutablePath(kind, selected);
    } catch {
      setError('Could not choose a local agent executable.');
    }
  };

  return (
    <section
      aria-labelledby="local-agent-settings-heading"
      data-testid="settings-local-agents"
      className="flex flex-col gap-4 rounded-xl border border-border bg-muted/15 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="local-agent-settings-heading" className="text-sm font-medium">
            Local AI Agents
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Check whether supported local agent commands are available. Markdowner only uses an
            agent after you explicitly start a request.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Refresh local agent status"
          aria-busy={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <Label
          htmlFor="local-agent-disclosure"
          className="flex flex-col items-start gap-1 text-left"
        >
          <span>Allow local agent processing</span>
          <span className="text-xs font-normal leading-relaxed text-muted-foreground">
            This is separate from OpenRouter cloud processing consent.
          </span>
        </Label>
        <Switch
          id="local-agent-disclosure"
          aria-label="Allow local agent processing"
          checked={disclosureAccepted}
          onCheckedChange={onDisclosureAcceptedChange}
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        {AGENTS.map((agent) => {
          const status = statuses.find((candidate) => candidate.kind === agent.kind);
          return (
            <div
              key={agent.kind}
              data-testid="local-agent-status-row"
              className="grid min-w-0 gap-2 border-b border-border px-3 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {agent.label}{' '}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {agent.mention}
                    </span>
                  </p>
                  {status?.pathLabel ? (
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {status.pathLabel}
                    </p>
                  ) : null}
                  {status?.source ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {status.source === 'manual' ? 'Manual path' : 'Automatic'}
                    </p>
                  ) : null}
                  {status?.version ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Version {status.version}
                    </p>
                  ) : null}
                  {status?.reason ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{status.reason}</p>
                  ) : null}
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusClass(status)}`}>
                  {statusLabel(status)}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  value={draftPaths[agent.kind]}
                  aria-label={`${agent.label} executable path`}
                  placeholder="Auto-detect from PATH"
                  spellCheck={false}
                  onChange={(event) => {
                    dirtyPathsRef.current.add(agent.kind);
                    setDraftPaths((current) => ({
                      ...current,
                      [agent.kind]: event.target.value,
                    }));
                  }}
                  onBlur={(event) =>
                    commitDraftExecutablePath(agent.kind, event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitDraftExecutablePath(agent.kind, event.currentTarget.value);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Browse ${agent.label} executable`}
                  onClick={() => void browse(agent.kind)}
                >
                  Browse…
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Reset ${agent.label} executable path`}
                  disabled={draftPaths[agent.kind].trim().length === 0}
                  onClick={() => void persistExecutablePath(agent.kind, '')}
                >
                  Reset to Auto
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>
          The local executable may contact its configured provider and consume quota under that
          provider&apos;s account and policies.
        </p>
        <p>
          An embedded run sends the current document snapshot without its file path. Tools are
          disabled and Markdowner alone applies results.
        </p>
        <p>Markdowner does not store agent credentials or estimate provider cost.</p>
        <p>OpenCode may retain local session metadata according to its installation settings.</p>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : null}
    </section>
  );
}

function statusLabel(status: LocalAgentStatus | undefined): string {
  if (!status) return 'Not checked';
  if (!status.installed) return 'Not installed';
  return status.compatible ? 'Compatible' : 'Incompatible';
}

function statusClass(status: LocalAgentStatus | undefined): string {
  if (status?.compatible) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status?.installed) return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}
