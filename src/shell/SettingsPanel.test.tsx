import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/lib/settings';
import type { UpdateInfo } from '@/lib/updateCheck';

import { SettingsPanel } from './SettingsPanel';

const diagnosticsStatusMock = vi.hoisted(() => vi.fn());
const openDiagnosticsLogMock = vi.hoisted(() => vi.fn());
const openExternalUrlInNewWindowMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings')>();
  return {
    ...actual,
    cliBinaryStatus: vi.fn().mockResolvedValue({
      installPath: '',
      targetExecutable: '',
      installed: false,
      inPath: false,
    }),
    ctrlGLauncherStatus: vi.fn().mockResolvedValue({
      shellConfigPath: '',
      snippet: '',
      installed: false,
    }),
    diagnosticsStatus: diagnosticsStatusMock,
    openDiagnosticsLog: openDiagnosticsLogMock,
  };
});

vi.mock('@/lib/desktop', () => ({
  openExternalUrlInNewWindow: openExternalUrlInNewWindowMock,
}));

const availableUpdate: UpdateInfo = {
  available: true,
  currentVersion: '0.260528.2',
  latestVersion: '0.260601.0',
  dmgUrl: 'https://example.com/x.dmg',
  releaseUrl: 'https://example.com/release',
  notes: '',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const props = {
    settings: DEFAULT_SETTINGS,
    onSettingsChange: vi.fn(),
    currentTheme: 'light' as const,
    onThemeChange: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof SettingsPanel>;
  render(<SettingsPanel {...props} />);
  return props;
}

describe('SettingsPanel update section', () => {
  beforeEach(() => {
    diagnosticsStatusMock.mockReset();
    diagnosticsStatusMock.mockResolvedValue({
      enabled: true,
      logPath: '/Users/channprj/Library/Application Support/dev.chann.markdowner/logs/markdowner.log',
    });
    openDiagnosticsLogMock.mockReset();
    openDiagnosticsLogMock.mockResolvedValue(undefined);
    openExternalUrlInNewWindowMock.mockReset();
    openExternalUrlInNewWindowMock.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('shows the update action and fires onUpdateAction when available', () => {
    const onUpdateAction = vi.fn();
    renderPanel({ updateInfo: availableUpdate, onUpdateAction });
    expect(screen.getByTestId('settings-update-available')).toHaveTextContent('0.260601.0');
    fireEvent.click(screen.getByTestId('settings-update-action'));
    expect(onUpdateAction).toHaveBeenCalledTimes(1);
  });

  it('shows "Check now" and fires onCheckForUpdate when no update is available', () => {
    const onCheckForUpdate = vi.fn();
    renderPanel({ updateInfo: null, onCheckForUpdate });
    expect(screen.queryByTestId('settings-update-action')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-update-check'));
    expect(onCheckForUpdate).toHaveBeenCalledTimes(1);
  });

  it('toggles the launch update-check setting', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });
    fireEvent.click(screen.getByTestId('settings-update-toggle'));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ updateCheckEnabled: false }),
    );
  });

  it('renders and toggles WYSIWYG code block wrapping', () => {
    const onSettingsChange = vi.fn();
    renderPanel({
      settings: {
        ...DEFAULT_SETTINGS,
        wysiwygCodeBlockWrap: true,
      },
      onSettingsChange,
    });

    expect(
      screen.getByText('Wrap long code lines instead of scrolling horizontally.'),
    ).toBeInTheDocument();
    const wrapSwitch = screen.getByLabelText(/WYSIWYG Code Block Wrap/i);
    expect(wrapSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(wrapSwitch);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      wysiwygCodeBlockWrap: false,
    });
  });

  it('shows the diagnostics log path and opens the log file', async () => {
    renderPanel();

    const logPath = await screen.findByTestId('settings-diagnostics-log-path');
    await waitFor(() => {
      expect(logPath).toHaveTextContent(
        '/Users/channprj/Library/Application Support/dev.chann.markdowner/logs/markdowner.log',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /open log file/i }));

    expect(openDiagnosticsLogMock).toHaveBeenCalledTimes(1);
  });

  it('opens report and feedback destinations in a new browser window', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    fireEvent.click(screen.getByRole('button', { name: /feedback/i }));

    expect(openExternalUrlInNewWindowMock).toHaveBeenNthCalledWith(
      1,
      'https://github.com/channprj/markdowner/issues',
    );
    expect(openExternalUrlInNewWindowMock).toHaveBeenNthCalledWith(
      2,
      'https://github.com/channprj/markdowner/discussions',
    );
  });

  it('renders terminal preferences and persists edits', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    fireEvent.change(screen.getByLabelText(/^terminal font family$/i), {
      target: { value: 'JetBrains Mono' },
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ terminalFontFamily: 'JetBrains Mono' }),
    );

    fireEvent.change(screen.getByLabelText(/^terminal font size$/i), {
      target: { value: '16' },
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ terminalFontSize: 16 }),
    );

    fireEvent.change(screen.getByLabelText(/^terminal default path$/i), {
      target: { value: '/tmp/project' },
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ terminalDefaultPath: '/tmp/project' }),
    );

    fireEvent.click(screen.getByRole('radio', { name: /^workspace directory$/i }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ terminalStartLocation: 'workspace' }),
    );
  });

  it('persists A3 size and landscape orientation', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'A3' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ pdfPaperSize: 'A3' }),
    );

    cleanup();
    renderPanel({
      settings: {
        ...DEFAULT_SETTINGS,
        pdfPaperSize: 'A3',
      },
      onSettingsChange,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pdfPaperSize: 'A3',
        pdfPaperOrientation: 'landscape',
      }),
    );
  });

  it('persists valid Custom dimensions', () => {
    const onSettingsChange = vi.fn();
    renderPanel({
      settings: {
        ...DEFAULT_SETTINGS,
        pdfPaperSize: 'Custom',
      },
      onSettingsChange,
    });

    fireEvent.change(screen.getByLabelText('Width'), {
      target: { value: '180.5' },
    });

    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pdfPaperSize: 'Custom',
        pdfPaperWidthMm: 180.5,
        pdfPaperHeightMm: 297,
      }),
    );
  });
});
