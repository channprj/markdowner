import type { AiByteRange } from '../types';

export type LocalAgentKind = 'claude' | 'codex' | 'opencode';
export type LocalAgentTargetKind = 'insert' | 'selection' | 'document';

export interface LocalAgentStatus {
  kind: LocalAgentKind;
  mention: '@claude' | '@codex' | '@opencode';
  label: 'Claude Code' | 'Codex' | 'OpenCode';
  installed: boolean;
  compatible: boolean;
  pathLabel: string | null;
  version: string | null;
  reason: string | null;
  source: 'manual' | 'automatic' | null;
}

export interface LocalAgentRunRequest {
  requestId: string;
  documentId: string;
  agent: LocalAgentKind;
  target: LocalAgentTargetKind;
  source: string;
  selection: AiByteRange | null;
  cursor: number | null;
  instruction: string;
  executablePath: string | null;
}

export interface LocalAgentRunResult {
  schemaVersion: 1;
  requestId: string;
  documentId: string;
  agent: LocalAgentKind;
  target: LocalAgentTargetKind;
  markdown: string;
  summary: string;
  warnings: string[];
}

export type LocalAgentStreamEvent =
  | { type: 'starting'; requestId: string }
  | { type: 'running'; requestId: string }
  | { type: 'validating'; requestId: string }
  | { type: 'completed'; requestId: string }
  | { type: 'failed'; requestId: string; code: string; message: string }
  | { type: 'cancelled'; requestId: string };
