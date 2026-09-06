import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiRunProgress } from './AiRunProgress';
import type { AiActiveRun } from './types';
import type { AiRuntimeServices } from './useAiRuntime';

describe('live AI progress', () => {
  it('lets the request be cancelled before its activity snapshot arrives', async () => {
    const services: AiRuntimeServices = {
      listActive: vi.fn(() => new Promise<AiActiveRun[]>(() => {})),
      historyPage: vi.fn(), listen: vi.fn().mockResolvedValue(vi.fn()),
    };
    const cancel = vi.fn().mockResolvedValue(true);
    const { unmount } = render(<AiRunProgress requestId="pending-run" services={services} cancelService={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel AI request' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('pending-run'));
    expect(screen.getByRole('button', { name: 'Cancel AI request' })).toBeDisabled();
    unmount();
  });

  it('shows status and cancellation failures and allows retry without an activity snapshot', async () => {
    const services: AiRuntimeServices = {
      listActive: vi.fn().mockRejectedValue(new Error('Live status unavailable')),
      historyPage: vi.fn(), listen: vi.fn().mockResolvedValue(vi.fn()),
    };
    const cancel = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(false);
    const { unmount } = render(<AiRunProgress requestId="run-1" services={services} cancelService={cancel} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Live status unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel AI request' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not cancel the request. Try again.'));
    expect(screen.getByRole('button', { name: 'Cancel AI request' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel AI request' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The request is no longer active.'));
    expect(cancel).toHaveBeenCalledTimes(2);
    unmount();
  });

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
