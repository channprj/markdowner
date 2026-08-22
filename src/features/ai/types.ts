export type AiTask = 'prd' | 'summary' | 'translation' | 'custom';
export type AiScope = 'document' | 'selection';

export interface AiDocumentRef {
  documentId: string;
  path: string | null;
  label: string;
}

export type AiRunScope =
  | { kind: 'document'; target: AiDocumentRef }
  | {
      kind: 'workspace';
      rootPath: string;
      target: AiDocumentRef | null;
      documentCount: number;
    };

export interface AiModelPricing {
  /** USD per token. */
  prompt: number | null;
  /** USD per token. */
  completion: number | null;
  updatedAt: string;
  /** Present for live endpoint lookups; absent for catalog-level pricing. */
  eligibleEndpointCount?: number | null;
}

export interface AiModel {
  id: string;
  name: string;
  description?: string | null;
  contextLength: number;
  /** Maximum completion size reported by OpenRouter's preferred provider. */
  maxCompletionTokens?: number | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  pricing: AiModelPricing;
}

export interface AiModelOption extends AiModel {
  pinned: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

export interface AiKeyStatus {
  configured: boolean;
  maskedLabel: string | null;
}

export interface AiKeyMetadata extends AiKeyStatus {
  label: string | null;
  limit: number | null;
  limitRemaining: number | null;
  usage: number | null;
  expiresAt: string | null;
  isFreeTier: boolean | null;
}

export interface AiByteRange {
  start: number;
  end: number;
}

export interface AiRunRequest {
  requestId: string;
  documentId: string;
  source: string;
  selection: AiByteRange | null;
  task: AiTask;
  model: string;
  targetLanguage: string | null;
  instruction: string | null;
  zdrOnly: boolean;
  maxOutputTokens: number;
  recordHistory: boolean;
  scope?: AiRunScope;
  interviewId?: string | null;
  resume?: boolean;
}

export type AiInterviewStatus =
  | 'awaiting_model'
  | 'awaiting_answer'
  | 'ready_to_generate'
  | 'generating'
  | 'completed';

export interface AiPrdInterviewTurn {
  id: string;
  position: number;
  question: string;
  rationale: string;
  recommendedAnswer: string;
  unresolvedArea: string;
  answer: string | null;
  skipped: boolean;
}

export interface AiInterviewSession {
  requestId: string;
  documentId: string;
  model: string;
  scope: AiRunScope;
  sourceHash: string;
  status: AiInterviewStatus;
  turns: AiPrdInterviewTurn[];
}

export interface AiInterviewStartRequest {
  requestId: string;
  documentId: string;
  source: string;
  model: string;
  instruction: string | null;
  zdrOnly: boolean;
  maxOutputTokens: number;
  scope: AiRunScope;
}

export interface AiInterviewContinueRequest {
  requestId: string;
  source: string;
  answer: string | null;
  instruction: string | null;
  zdrOnly: boolean;
  maxOutputTokens: number;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
  costCalculated: boolean;
}

export type AiStreamEvent =
  | { type: 'started'; requestId: string; generationId: string | null }
  | { type: 'progress'; requestId: string; receivedCharacters: number }
  | { type: 'completed'; requestId: string; generationId: string | null }
  | { type: 'failed'; requestId: string; code: string; message: string }
  | { type: 'cancelled'; requestId: string };

export interface AiValidationIssue {
  code: string;
  message: string;
  segmentId: string | null;
}

export interface AiValidatedOperation {
  id: string;
  kind: 'replace' | 'insert_before' | 'insert_after';
  targetSegmentId: string;
  sourceRange: AiByteRange;
  originalMarkdown: string;
  proposedMarkdown: string;
  findingIds: string[];
}

export interface AiFinding {
  id: string;
  severity: string;
  category: string;
  evidenceSegmentId: string | null;
  rationale: string;
}

export interface AiValidatedDocument {
  sourceRevisionHash: string;
  proposedMarkdown: string;
  validation: {
    passed: boolean;
    issues: AiValidationIssue[];
  };
  operations: AiValidatedOperation[];
  hunks: Array<{
    operationId: string;
    sourceRange: AiByteRange;
    originalMarkdown: string;
    proposedMarkdown: string;
  }>;
  summary: string | null;
  findings: AiFinding[];
  assumptions: string[];
  detectedSourceLanguage: string | null;
  targetLanguage: string | null;
  warnings: string[];
}

export interface AiRunResult {
  requestId: string;
  documentId: string;
  task: AiTask;
  model: string;
  generationId: string | null;
  result: AiValidatedDocument | null;
  validationIssues: AiValidationIssue[];
  rawDiagnostic: string | null;
  usage: AiUsage | null;
  retryAfterSeconds: number | null;
}

export type AiFeatureTab = 'new' | 'activity' | 'history';
export type AiActiveStatus = 'queued' | 'running' | 'cancelling';
export type AiRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface AiActivityProgress {
  stage: string;
  fileCompleted: number | null;
  fileTotal: number | null;
  chunkCompleted: number | null;
  chunkTotal: number | null;
  label: string | null;
  receivedCharacters: number;
}

export interface AiActiveRun {
  requestId: string;
  task: AiTask;
  model: string;
  scope: AiRunScope;
  status: AiActiveStatus;
  progress: AiActivityProgress;
  startedAt: number;
  cancelable: boolean;
}

export interface AiInterviewTurn {
  id?: string;
  position: number;
  question: string;
  answer: string | null;
  skipped: boolean;
  rationale?: string;
  recommendedAnswer?: string;
  unresolvedArea?: string;
}

export interface AiHistorySummary {
  id: string;
  task: AiTask;
  model: string;
  status: AiRunStatus;
  scopeJson: string;
  sourceHash: string;
  promptVersion: string;
  instruction: string | null;
  targetLanguage: string | null;
  maxOutputTokens: number | null;
  zdrOnly: boolean | null;
  resultJson: string | null;
  errorJson: string | null;
  usageJson: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface AiHistoryDetail extends AiHistorySummary {
  interviewTurns?: AiInterviewTurn[];
}

export interface AiHistoryPage {
  items: AiHistorySummary[];
  page: number;
  pageSize: number;
  total: number;
}
