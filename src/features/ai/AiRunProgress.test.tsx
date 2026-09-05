import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiRunProgress } from './AiRunProgress';
import type { AiActiveRun } from './types';
import type { AiRuntimeServices } from './useAiRuntime';

describe('live AI progress', () => {
  it('shows the requested run stage, characters, chunk progress, and cancellation', async () => {
    const run: AiActiveRun = {
      requestId: 'run-1', task: 'summary', model: 'test/model', status: 'running',
      scope: { kind: 'document', target: { documentId: 'doc', path: null, label: 'Long document' } },
      startedAt: Math.floor(Date.now() / 1000) - 8, cancelable: true,
      progress: { stage: 'processing_chunks', label: 'Receiving document part', fileCompleted: null,
        fileTotal: null, chunkCompleted: 2, chunkTotal: 5, receivedCharacters: 2400 },
    };
    const services: AiRuntimeServices = {
      listActive: vi.fn().mockResolvedValue([run]), historyPage: vi.fn(),
      listen: vi.fn().mockResolvedValue(vi.fn()),
    };
    const cancel = vi.fn().mockResolvedValue(true);
    const { unmount } = render(<AiRunProgress requestId="run-1" services={services} cancelService={cancel} />);
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5');
    expect(screen.getByText(/2,400 characters received/)).toBeVisible();
    expect(screen.getByText(/8s elapsed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Cancel Summarize document/ }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('run-1'));
    unmount();
  });
});
