function displayDocumentName(name: string | null | undefined): string {
  return name ?? 'Untitled.md';
}

export type ExternalChangeViewState = {
  message: string | null;
  showActions: boolean;
  compareSource: string | null;
};

export const CLEARED_EXTERNAL_CHANGE_STATE: ExternalChangeViewState = {
  message: null,
  showActions: false,
  compareSource: null,
};

export function formatExternalChangeDetected(name: string | null | undefined): string {
  return `Could not save '${displayDocumentName(name)}' because it changed on disk.`;
}

export function formatExternalChangeVerificationError(
  name: string | null | undefined,
  reason: string,
): string {
  return `Could not verify external changes for '${displayDocumentName(name)}': ${reason}`;
}

export function formatDiskReadError(
  name: string | null | undefined,
  reason: string,
): string {
  return `Could not read disk version of '${displayDocumentName(name)}': ${reason}`;
}

export function externalChangeDetectedState(
  name: string | null | undefined,
): ExternalChangeViewState {
  return {
    message: formatExternalChangeDetected(name),
    showActions: true,
    compareSource: null,
  };
}

export function externalChangeVerificationErrorState(
  name: string | null | undefined,
  reason: string,
): ExternalChangeViewState {
  return {
    message: formatExternalChangeVerificationError(name, reason),
    showActions: false,
    compareSource: null,
  };
}
