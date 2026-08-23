import { useEffect, useMemo, useRef, useState } from "react";
import { Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  localAgentCancel,
  localAgentRun,
  localAgentStatuses,
} from "@/lib/desktop";
import type { LocalAgentExecutablePaths } from "@/lib/settings";

import { filterLocalAgentMentions } from "./mentions";
import {
  asDocumentLocalAgentTarget,
  isValidLocalAgentTargetSnapshot,
} from "./targets";
import type { LocalAgentTargetSnapshot } from "./targets";
import type {
  LocalAgentKind,
  LocalAgentRunRequest,
  LocalAgentRunResult,
  LocalAgentStatus,
  LocalAgentStreamEvent,
  LocalAgentTargetKind,
} from "./types";

export interface LocalAgentComposerServices {
  listStatuses: (paths: LocalAgentExecutablePaths) => Promise<LocalAgentStatus[]>;
  run: (
    request: LocalAgentRunRequest,
    onEvent: (event: LocalAgentStreamEvent) => void,
  ) => Promise<LocalAgentRunResult>;
  cancel: (requestId: string) => Promise<boolean>;
}

export interface LocalAgentComposerProps {
  snapshot: LocalAgentTargetSnapshot;
  documentLabel: string;
  disclosureAccepted: boolean;
  preferredAgent?: LocalAgentKind | null;
  initialInstruction?: string;
  initialTarget?: LocalAgentTargetKind;
  executablePaths: LocalAgentExecutablePaths;
  onDisclosureAcceptedChange: (accepted: boolean) => void;
  onClose: () => void;
  onResult: (
    result: LocalAgentRunResult,
    snapshot: LocalAgentTargetSnapshot,
    request: LocalAgentRunRequest,
  ) => void;
  services?: LocalAgentComposerServices;
}

const DEFAULT_SERVICES: LocalAgentComposerServices = {
  listStatuses: localAgentStatuses,
  run: localAgentRun,
  cancel: localAgentCancel,
};

export function LocalAgentComposer({
  snapshot,
  documentLabel,
  disclosureAccepted,
  preferredAgent = null,
  initialInstruction = "",
  initialTarget = snapshot.kind,
  executablePaths,
  onDisclosureAcceptedChange,
  onClose,
  onResult,
  services = DEFAULT_SERVICES,
}: LocalAgentComposerProps) {
  const [statuses, setStatuses] = useState<LocalAgentStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<LocalAgentKind | null>(
    preferredAgent,
  );
  const [mentionOpen, setMentionOpen] = useState(preferredAgent === null);
  const [mentionQuery, setMentionQuery] = useState("@");
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [target, setTarget] = useState<LocalAgentTargetKind>(
    initialTarget === "document" ? "document" : snapshot.kind,
  );
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(
    null,
  );
  const [lifecycleStatus, setLifecycleStatus] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const statusGenerationRef = useRef(0);
  const runGenerationRef = useRef(0);
  const runningRequestIdRef = useRef<string | null>(null);
  const cancelAttemptRef = useRef<{
    requestId: string;
    generation: number;
    inFlight: boolean;
    cancelled: boolean;
  } | null>(null);
  const activeCancelRef = useRef<
    ((requestId: string) => Promise<boolean>) | null
  >(null);
  const mentionInputRef = useRef<HTMLInputElement | null>(null);
  const instructionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreChangeFocusRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      const activeRequestId = runningRequestIdRef.current;
      const activeGeneration = runGenerationRef.current;
      statusGenerationRef.current += 1;
      mountedRef.current = false;
      runGenerationRef.current += 1;
      const attempt = cancelAttemptRef.current;
      if (
        activeRequestId &&
        !(
          attempt?.requestId === activeRequestId &&
          attempt.generation === activeGeneration &&
          (attempt.inFlight || attempt.cancelled)
        )
      ) {
        cancelAttemptRef.current = {
          requestId: activeRequestId,
          generation: activeGeneration,
          inFlight: true,
          cancelled: false,
        };
        void activeCancelRef.current?.(activeRequestId).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const generation = statusGenerationRef.current + 1;
    statusGenerationRef.current = generation;
    setStatusLoading(true);
    setStatusError("");
    void services
      .listStatuses(executablePaths)
      .then((nextStatuses) => {
        if (mountedRef.current && statusGenerationRef.current === generation) {
          setStatuses(nextStatuses);
        }
      })
      .catch(() => {
        if (mountedRef.current && statusGenerationRef.current === generation) {
          setStatusError("Could not refresh local agent status.");
        }
      })
      .finally(() => {
        if (mountedRef.current && statusGenerationRef.current === generation) {
          setStatusLoading(false);
        }
      });
  }, [executablePaths, services]);

  useEffect(() => {
    if (mentionOpen) {
      mentionInputRef.current?.focus();
    } else if (restoreChangeFocusRef.current) {
      restoreChangeFocusRef.current = false;
      changeButtonRef.current?.focus();
    } else if (selectedAgent !== null) {
      instructionInputRef.current?.focus();
    }
  }, [mentionOpen, selectedAgent]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || runningRequestIdRef.current || mentionOpen)
        return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mentionOpen, onClose]);

  const mentionOptions = useMemo(
    () => filterLocalAgentMentions(mentionQuery),
    [mentionQuery],
  );
  const compatibleMentionOptions = useMemo(
    () =>
      mentionOptions.filter((agent) =>
        statuses.some(
          (status) => status.kind === agent.kind && status.compatible,
        ),
      ),
    [mentionOptions, statuses],
  );
  const activeMention = compatibleMentionOptions[activeMentionIndex] ?? null;
  const selectedStatus = selectedAgent
    ? (statuses.find((status) => status.kind === selectedAgent) ?? null)
    : null;
  const trimmedInstruction = instruction.trim();
  const resolvedDocumentLabel = documentLabel.trim() || "Untitled";
  const targetDescription =
    target === "document"
      ? `The full-document proposal for ${resolvedDocumentLabel} opens in Review and remains unapplied until you choose Apply.`
      : snapshot.kind === "selection"
        ? `Replaces the selected text in ${resolvedDocumentLabel} only if the captured target is unchanged. The edit is applied automatically and can be undone.`
        : `Inserts at the captured cursor in ${resolvedDocumentLabel} only if the captured target is unchanged. The edit is applied automatically and can be undone.`;
  const canRun = Boolean(
    selectedAgent &&
      selectedStatus?.compatible &&
      disclosureAccepted &&
      trimmedInstruction &&
      !statusLoading &&
      !runningRequestId &&
      isValidLocalAgentTargetSnapshot(
        target === "document" ? asDocumentLocalAgentTarget(snapshot) : snapshot,
      ),
  );
  const isCurrentRun = (requestId: string, generation: number) =>
    mountedRef.current &&
    runGenerationRef.current === generation &&
    runningRequestIdRef.current === requestId;
  const isCancelledRun = (requestId: string, generation: number) => {
    const attempt = cancelAttemptRef.current;
    return (
      attempt?.requestId === requestId &&
      attempt.generation === generation &&
      attempt.cancelled
    );
  };

  const selectAgent = (agent: LocalAgentKind) => {
    const status = statuses.find((candidate) => candidate.kind === agent);
    if (!status?.compatible) return;
    setSelectedAgent(agent);
    setMentionQuery("@");
    setActiveMentionIndex(0);
    restoreChangeFocusRef.current = false;
    setMentionOpen(false);
    setError("");
  };

  const handleMentionKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      restoreChangeFocusRef.current = selectedAgent !== null;
      setMentionOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!compatibleMentionOptions.length) {
        setActiveMentionIndex(-1);
        return;
      }
      setActiveMentionIndex((current) => {
        const change = event.key === "ArrowDown" ? 1 : -1;
        return (
          (current + change + compatibleMentionOptions.length) %
          compatibleMentionOptions.length
        );
      });
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (activeMention) selectAgent(activeMention.kind);
    }
  };

  const handleRun = async () => {
    if (!canRun || !selectedAgent) return;
    const requestId = createRequestId();
    const requestSnapshot =
      target === "document" ? asDocumentLocalAgentTarget(snapshot) : snapshot;
    const request = requestFromSnapshot(
      requestSnapshot,
      selectedAgent,
      requestId,
      trimmedInstruction,
      executablePaths[selectedAgent],
    );
    if (!request) return;
    const generation = runGenerationRef.current + 1;
    runGenerationRef.current = generation;
    runningRequestIdRef.current = requestId;
    cancelAttemptRef.current = null;
    activeCancelRef.current = services.cancel;
    setRunningRequestId(requestId);
    setLifecycleStatus("Starting local agent…");
    setError("");
    try {
      const result = await services.run(request, (event) => {
        if (
          !mountedRef.current ||
          runGenerationRef.current !== generation ||
          event.requestId !== requestId ||
          isCancelledRun(requestId, generation)
        )
          return;
        if (event.type === "failed") {
          setError("Local agent request failed.");
        } else {
          setLifecycleStatus(lifecycleLabel(event.type));
        }
      });
      if (
        isCurrentRun(requestId, generation) &&
        !isCancelledRun(requestId, generation)
      ) {
        onResult(result, requestSnapshot, request);
      }
    } catch {
      if (
        isCurrentRun(requestId, generation) &&
        !isCancelledRun(requestId, generation)
      ) {
        setError("Could not run local agent.");
      }
    } finally {
      if (isCurrentRun(requestId, generation)) {
        const cancelled = isCancelledRun(requestId, generation);
        runningRequestIdRef.current = null;
        activeCancelRef.current = null;
        setCancellingRequestId(null);
        setRunningRequestId(null);
        if (cancelled) {
          setError("");
          setLifecycleStatus("Local agent request cancelled.");
        }
      }
    }
  };

  const handleCancel = async () => {
    const requestId = runningRequestIdRef.current;
    const generation = runGenerationRef.current;
    const previousAttempt = cancelAttemptRef.current;
    if (
      !requestId ||
      (previousAttempt?.requestId === requestId &&
        previousAttempt.generation === generation &&
        (previousAttempt.inFlight || previousAttempt.cancelled))
    ) {
      return;
    }
    const attempt = {
      requestId,
      generation,
      inFlight: true,
      cancelled: false,
    };
    cancelAttemptRef.current = attempt;
    setCancellingRequestId(requestId);
    if (error === "Could not cancel local agent.") {
      setError("");
    }
    setLifecycleStatus("Cancelling local agent…");
    try {
      const cancelled = await (activeCancelRef.current ?? services.cancel)(
        requestId,
      );
      if (
        !isCurrentRun(requestId, generation) ||
        cancelAttemptRef.current !== attempt
      ) {
        return;
      }
      if (!cancelled) {
        cancelAttemptRef.current = null;
        setCancellingRequestId(null);
        setError("Could not cancel local agent.");
        return;
      }
      attempt.inFlight = false;
      attempt.cancelled = true;
      setError("");
      setLifecycleStatus("Cancelling local agent…");
    } catch {
      if (
        isCurrentRun(requestId, generation) &&
        cancelAttemptRef.current === attempt
      ) {
        cancelAttemptRef.current = null;
        setCancellingRequestId(null);
        setError("Could not cancel local agent.");
      }
    }
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="local-agent-composer-heading"
      data-testid="local-agent-composer"
      className="ai-motion-surface fixed bottom-12 left-1/2 z-[80] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="local-agent-composer-heading"
            className="text-sm font-semibold"
          >
            Run a local agent
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Review the captured destination before starting the local executable.
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close local agent"
          disabled={Boolean(runningRequestId)}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="mt-3 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="local-agent-mention">Local agent</Label>
          {selectedAgent && !mentionOpen ? (
            <div className="flex items-center justify-between rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <span className="font-mono">@{selectedAgent}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(runningRequestId)}
                  aria-label="Change local agent"
                  ref={changeButtonRef}
                  onClick={() => setMentionOpen(true)}
                >
                  Change
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={Boolean(runningRequestId)}
                  aria-label={`Remove @${selectedAgent}`}
                  onClick={() => {
                    setSelectedAgent(null);
                    setMentionOpen(true);
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <input
                id="local-agent-mention"
                ref={mentionInputRef}
                aria-label="Local agent"
                aria-controls="local-agent-mention-list"
                aria-expanded={mentionOpen}
                aria-activedescendant={
                  activeMention
                    ? `local-agent-option-${activeMention.kind}`
                    : undefined
                }
                value={mentionQuery}
                disabled={Boolean(runningRequestId)}
                onChange={(event) => {
                  setMentionQuery(event.target.value);
                  setActiveMentionIndex(0);
                  setMentionOpen(true);
                }}
                onKeyDown={handleMentionKeyDown}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {mentionOpen ? (
                <div
                  id="local-agent-mention-list"
                  role="listbox"
                  aria-label="Local agent suggestions"
                  className="mt-1 grid overflow-hidden rounded-md border border-border"
                >
                  {mentionOptions.map((agent) => {
                    const status = statuses.find(
                      (candidate) => candidate.kind === agent.kind,
                    );
                    const unavailable = statusLoading || !status?.compatible;
                    return (
                      <button
                        key={agent.kind}
                        id={`local-agent-option-${agent.kind}`}
                        type="button"
                        role="option"
                        aria-selected={agent.kind === activeMention?.kind}
                        disabled={unavailable || Boolean(runningRequestId)}
                        onClick={() => selectAgent(agent.kind)}
                        className="flex items-center justify-between gap-3 border-b border-border px-2 py-2 text-left text-sm last:border-b-0 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>
                          <span className="font-mono">{agent.mention}</span> ·{" "}
                          {agent.label}
                        </span>
                        {!statusLoading && !status?.compatible ? (
                          <span className="text-xs text-muted-foreground">
                            {status?.reason ?? "Unavailable"}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
          {statusError ? (
            <p role="alert" className="text-xs text-destructive">
              {statusError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="local-agent-instruction">Instruction</Label>
          <textarea
            ref={instructionInputRef}
            id="local-agent-instruction"
            aria-label="Instruction"
            rows={3}
            value={instruction}
            disabled={Boolean(runningRequestId)}
            onChange={(event) => setInstruction(event.target.value)}
            className="w-full resize-y rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Describe the requested change…"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="local-agent-target">Result destination</Label>
          <select
            id="local-agent-target"
            aria-describedby="local-agent-target-description"
            value={target}
            disabled={Boolean(runningRequestId)}
            onChange={(event) =>
              setTarget(event.target.value as LocalAgentTargetKind)
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {snapshot.kind !== "document" ? (
              <option value={snapshot.kind}>
                {snapshot.kind === "selection"
                  ? `Replace selected text in ${resolvedDocumentLabel}`
                  : `Insert at captured cursor in ${resolvedDocumentLabel}`}
              </option>
            ) : null}
            <option value="document">
              Full-document proposal for {resolvedDocumentLabel}
            </option>
          </select>
          <p
            id="local-agent-target-description"
            className="text-xs text-muted-foreground"
          >
            {targetDescription}
          </p>
        </div>

        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          <p>
            An embedded run sends the current {resolvedDocumentLabel} snapshot
            without its file path. Tools are disabled.
          </p>
          <p>
            {target === "document"
              ? "Markdowner opens the full-document result in Review and leaves it unapplied until you choose Apply."
              : snapshot.kind === "selection"
                ? "If the captured target is unchanged when the run finishes, Markdowner applies the replacement automatically as an undoable edit. Otherwise it opens in Review."
                : "If the captured target is unchanged when the run finishes, Markdowner inserts the result automatically as an undoable edit. Otherwise it opens in Review."}
          </p>
          <p>
            The local executable may contact its configured provider and
            consume a subscription, credits, or API quota. Markdowner does not
            store agent credentials or estimate provider cost.
          </p>
          <p>
            OpenCode may retain local session metadata according to its
            installation and provider configuration.
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Label
            htmlFor="local-agent-disclosure"
            className="text-xs font-normal text-muted-foreground"
          >
            Allow this local agent to process the current document snapshot.
          </Label>
          <Switch
            id="local-agent-disclosure"
            aria-label="Allow local agent processing"
            checked={disclosureAccepted}
            disabled={Boolean(runningRequestId)}
            onCheckedChange={onDisclosureAcceptedChange}
          />
        </div>

        <div className="flex items-center gap-2">
          {runningRequestId ? (
            <Button
              type="button"
              variant="destructive"
              aria-label="Cancel local agent"
              disabled={cancellingRequestId === runningRequestId}
              onClick={() => void handleCancel()}
            >
              <Square aria-hidden="true" />
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!canRun}
              onClick={() => void handleRun()}
            >
              {target === "document"
                ? "Generate document proposal"
                : `Run ${selectedAgent ? `@${selectedAgent}` : "local agent"}`}
            </Button>
          )}
        </div>
        <p
          role={error || statusError ? "alert" : undefined}
          aria-live="polite"
          className={
            error || statusError
              ? "min-h-4 text-xs text-destructive"
              : "min-h-4 text-xs text-muted-foreground"
          }
        >
          {error || statusError || lifecycleStatus}
        </p>
      </div>
    </section>
  );
}

function requestFromSnapshot(
  snapshot: LocalAgentTargetSnapshot,
  agent: LocalAgentKind,
  requestId: string,
  instruction: string,
  executablePath: string,
): LocalAgentRunRequest | null {
  if (!isValidLocalAgentTargetSnapshot(snapshot)) return null;
  if (snapshot.kind === "document") {
    return {
      requestId,
      documentId: snapshot.documentId,
      agent,
      target: "document",
      source: snapshot.source,
      selection: null,
      cursor: null,
      instruction,
      executablePath: executablePath.trim() || null,
    };
  }
  if (!snapshot.byteRange) return null;
  return {
    requestId,
    documentId: snapshot.documentId,
    agent,
    target: snapshot.kind,
    source: snapshot.source,
    selection: snapshot.kind === "selection" ? { ...snapshot.byteRange } : null,
    cursor: snapshot.kind === "insert" ? snapshot.byteRange.start : null,
    instruction,
    executablePath: executablePath.trim() || null,
  };
}

function lifecycleLabel(
  type: Exclude<LocalAgentStreamEvent["type"], "failed">,
): string {
  switch (type) {
    case "starting":
      return "Starting local agent…";
    case "running":
      return "Local agent is running…";
    case "validating":
      return "Validating local agent result…";
    case "completed":
      return "Local agent completed.";
    case "cancelled":
      return "Local agent request cancelled.";
  }
}

function createRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function")
    return `local-agent-${cryptoApi.randomUUID()}`;
  const random = new Uint32Array(4);
  cryptoApi?.getRandomValues?.(random);
  return `local-agent-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(36)).join("")}-${Math.random().toString(36).slice(2)}`;
}
