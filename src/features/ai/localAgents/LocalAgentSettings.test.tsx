import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalAgentSettings } from './LocalAgentSettings';

const executablePaths = { claude: '', codex: '', opencode: '' };

afterEach(cleanup);

const statuses = [
  {
    kind: 'claude' as const,
    mention: '@claude' as const,
    label: 'Claude Code' as const,
    installed: true,
    compatible: true,
    pathLabel: 'claude (Homebrew)',
    version: '2.1.0',
    reason: null,
    source: 'automatic' as const,
  },
  {
    kind: 'codex' as const,
    mention: '@codex' as const,
    label: 'Codex' as const,
    installed: true,
    compatible: false,
    pathLabel: 'codex (PATH)',
    version: '0.3.0',
    reason: 'This version is not supported.',
    source: 'manual' as const,
  },
  {
    kind: 'opencode' as const,
    mention: '@opencode' as const,
    label: 'OpenCode' as const,
    installed: false,
    compatible: false,
    pathLabel: null,
    version: null,
    reason: 'Not found.',
    source: null,
  },
];

describe('LocalAgentSettings', () => {
  it('applies the automatic status refresh after StrictMode replays its effect cleanup', async () => {
    const pending = deferred<typeof statuses>();
    const listStatuses = vi.fn().mockReturnValue(pending.promise);
    render(
      <StrictMode>
        <LocalAgentSettings
          disclosureAccepted={false}
          onDisclosureAcceptedChange={vi.fn()}
          executablePaths={executablePaths}
          onExecutablePathsChange={vi.fn()}
          services={{ listStatuses }}
        />
      </StrictMode>,
    );

    const button = screen.getByRole('button', { name: 'Refresh local agent status' });
    await waitFor(() => expect(listStatuses).toHaveBeenCalled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Checking…')).toHaveLength(3);
    expect(screen.queryByText('Not checked')).not.toBeInTheDocument();

    await act(async () => pending.resolve(statuses));

    expect(screen.getByText('claude (Homebrew)')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('lets the newest manual refresh win when an older response resolves last', async () => {
    const older = deferred<typeof statuses>();
    const newer = deferred<typeof statuses>();
    const latestStatuses = statuses.map((status) =>
      status.kind === 'claude' ? { ...status, version: '9.9.9' } : status,
    );
    const listStatuses = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(
      <LocalAgentSettings
        disclosureAccepted={false}
        onDisclosureAcceptedChange={vi.fn()}
        executablePaths={executablePaths}
        onExecutablePathsChange={vi.fn()}
        services={{ listStatuses }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Refresh local agent status' });
    fireEvent.click(button);
    await waitFor(() => expect(listStatuses).toHaveBeenCalledTimes(2));

    await act(async () => newer.resolve(latestStatuses));
    expect(screen.getAllByTestId('local-agent-status-row')[0]).toHaveTextContent('Version 9.9.9');

    await act(async () => older.resolve(statuses));
    expect(screen.getAllByTestId('local-agent-status-row')[0]).toHaveTextContent('Version 9.9.9');
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('does not update after an in-flight automatic refresh unmounts', async () => {
    const pending = deferred<typeof statuses>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(
      <StrictMode>
        <LocalAgentSettings
          disclosureAccepted={false}
          onDisclosureAcceptedChange={vi.fn()}
          executablePaths={executablePaths}
          onExecutablePathsChange={vi.fn()}
          services={{ listStatuses: vi.fn().mockReturnValue(pending.promise) }}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Refresh local agent status',
    })).toHaveAttribute('aria-busy', 'true'));
    unmount();
    await act(async () => pending.resolve(statuses));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('refreshes fixed, redacted agent status rows and keeps local disclosure separate', async () => {
    const onDisclosureAcceptedChange = vi.fn();
    const listStatuses = vi.fn().mockResolvedValue(statuses);
    render(
      <LocalAgentSettings
        disclosureAccepted={false}
        onDisclosureAcceptedChange={onDisclosureAcceptedChange}
        executablePaths={executablePaths}
        onExecutablePathsChange={vi.fn()}
        services={{ listStatuses }}
      />,
    );

    expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
    expect(screen.getAllByTestId('local-agent-status-row').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Claude Code'),
      expect.stringContaining('Codex'),
      expect.stringContaining('OpenCode'),
    ]);

    await waitFor(() => expect(screen.getByText('Compatible')).toBeInTheDocument());

    expect(screen.getAllByTestId('local-agent-status-row').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Claude Code'),
      expect.stringContaining('Codex'),
      expect.stringContaining('OpenCode'),
    ]);
    expect(listStatuses).toHaveBeenCalledWith(executablePaths);
    expect(screen.getByText('Incompatible')).toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
    expect(screen.getAllByTestId('local-agent-status-row')[0]).toHaveTextContent('Version 2.1.0');
    expect(screen.getByText('This version is not supported.')).toBeInTheDocument();
    expect(screen.getByText('claude (Homebrew)')).toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
    expect(screen.getByText('Manual path')).toBeInTheDocument();
    expect(screen.queryByText('/opt/homebrew/bin/claude')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Allow local agent processing' }));
    expect(onDisclosureAcceptedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText(/may contact its configured provider and consume quota/i)).toBeInTheDocument();
    expect(screen.getByText(/sends the current document snapshot without its file path/i)).toBeInTheDocument();
    expect(screen.getByText(/Markdowner does not store agent credentials or estimate provider cost/i)).toBeInTheDocument();
    expect(screen.getByText(/tools are disabled and Markdowner alone applies results/i)).toBeInTheDocument();
    expect(screen.getByText(/OpenCode may retain local session metadata/i)).toBeInTheDocument();
  });

  it('keeps rows usable without rendering sensitive status-refresh failure details', async () => {
    const unsafeFailure = new Error(
      'AcmeSensitiveProvider rejected sk-local-secret at /private/tmp/local-agent-token',
    );
    render(
      <LocalAgentSettings
        disclosureAccepted
        onDisclosureAcceptedChange={vi.fn()}
        executablePaths={executablePaths}
        onExecutablePathsChange={vi.fn()}
        services={{ listStatuses: vi.fn().mockRejectedValue(unsafeFailure) }}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Could not refresh local agent status.',
    );
    expect(alert).not.toHaveTextContent(/AcmeSensitiveProvider|sk-local-secret|private\/tmp/i);
    expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
  });

  it('fails safely when the desktop bridge returns a malformed status payload', async () => {
    render(
      <LocalAgentSettings
        disclosureAccepted
        onDisclosureAcceptedChange={vi.fn()}
        executablePaths={executablePaths}
        onExecutablePathsChange={vi.fn()}
        services={{ listStatuses: vi.fn().mockResolvedValue(undefined) }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh local agent status.',
    );
    expect(screen.getAllByTestId('local-agent-status-row')).toHaveLength(3);
  });

  it('persists trimmed paths on blur or Enter and refreshes Browse and Reset immediately', async () => {
    const onExecutablePathsChange = vi.fn();
    const listStatuses = vi.fn().mockResolvedValue(statuses);
    const selectExecutable = vi
      .fn()
      .mockResolvedValueOnce('/Applications/Claude/claude')
      .mockResolvedValueOnce(null);
    const configured = {
      claude: '/custom/claude',
      codex: '/custom/codex',
      opencode: '/custom/opencode',
    };
    render(
      <LocalAgentSettings
        disclosureAccepted
        onDisclosureAcceptedChange={vi.fn()}
        executablePaths={configured}
        onExecutablePathsChange={onExecutablePathsChange}
        services={{ listStatuses, selectExecutable }}
      />,
    );

    await waitFor(() => expect(listStatuses).toHaveBeenCalledWith(configured));
    listStatuses.mockClear();

    const codexInput = screen.getByLabelText('Codex executable path');
    fireEvent.blur(codexInput);
    expect(onExecutablePathsChange).not.toHaveBeenCalled();
    expect(listStatuses).not.toHaveBeenCalled();

    fireEvent.change(codexInput, {
      target: { value: '  /new/codex  ' },
    });
    expect(onExecutablePathsChange).not.toHaveBeenCalled();

    fireEvent.blur(codexInput);
    const blurredPaths = {
      claude: '/custom/claude',
      codex: '/new/codex',
      opencode: '/custom/opencode',
    };
    await waitFor(() => {
      expect(onExecutablePathsChange).toHaveBeenCalledWith(blurredPaths);
      expect(listStatuses).toHaveBeenCalledWith(blurredPaths);
    });

    fireEvent.change(codexInput, { target: { value: '  /enter/codex  ' } });
    fireEvent.keyDown(codexInput, { key: 'Enter' });
    const enteredPaths = { ...blurredPaths, codex: '/enter/codex' };
    await waitFor(() => {
      expect(onExecutablePathsChange).toHaveBeenCalledWith(enteredPaths);
      expect(listStatuses).toHaveBeenCalledWith(enteredPaths);
    });

    expect(screen.getAllByText('Browse…')).toHaveLength(3);
    expect(screen.getAllByText('Reset to Auto')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Browse Claude Code executable' }));
    const browsedPaths = {
      ...enteredPaths,
      claude: '/Applications/Claude/claude',
    };
    await waitFor(() => {
      expect(onExecutablePathsChange).toHaveBeenCalledWith({
        ...browsedPaths,
      });
      expect(listStatuses).toHaveBeenCalledWith(browsedPaths);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browse OpenCode executable' }));
    await waitFor(() => expect(selectExecutable).toHaveBeenCalledTimes(2));
    expect(onExecutablePathsChange).not.toHaveBeenCalledWith({
      ...browsedPaths,
      opencode: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset Codex executable path' }));
    const resetPaths = {
      ...browsedPaths,
      codex: '',
    };
    await waitFor(() => {
      expect(onExecutablePathsChange).toHaveBeenCalledWith(resetPaths);
      expect(listStatuses).toHaveBeenCalledWith(resetPaths);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh local agent status' }));
    await waitFor(() => expect(listStatuses).toHaveBeenLastCalledWith(resetPaths));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
