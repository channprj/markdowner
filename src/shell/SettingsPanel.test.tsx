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
  aiKeyStatus: vi.fn().mockResolvedValue({
    configured: false,
    maskedLabel: null,
  }),
  aiSaveKey: vi.fn(),
  aiVerifyKey: vi.fn(),
  aiDeleteKey: vi.fn(),
  localAgentStatuses: vi.fn(),
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

  it('does not expose a GFM setting or explanation', () => {
    renderPanel();

    expect(
      screen.queryByRole('switch', { name: /gfm|github flavored markdown/i }),
    ).toBeNull();
    expect(screen.queryByText(/gfm|github flavored markdown/i)).toBeNull();
  });

  it('does not expose anonymous usage data sharing', () => {
    renderPanel();

    expect(screen.queryByText(/share anonymous usage data/i)).toBeNull();
    expect(screen.queryByTestId('settings-analytics-section')).toBeNull();
  });

  it('defines Auto Save to File separately from recovery backups', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    expect(
      screen.getByText(
        'Writes edits to the open file after 1 second. Recovery backups are always kept separately.',
      ),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Auto Save to File' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      autoSave: true,
    });
  });

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

  it('renders and toggles installed skill-token highlighting', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    expect(
      screen.getByText('Style installed Claude Code and Codex skills like /goal and $git-commit.'),
    ).toBeInTheDocument();
    const highlightSwitch = screen.getByLabelText(/skill token highlighting/i);
    expect(highlightSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(highlightSwitch);

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      highlightSkillTokens: false,
    });
  });

  it('renders theme-specific skill-token and inline-code color controls', () => {
    renderPanel({ inlineStyleTone: 'dark' });

    expect(screen.getByTestId('inline-style-color-settings')).toHaveAttribute(
      'data-tone',
      'dark',
    );
    expect(screen.getByText('Skill Token')).toBeInTheDocument();
    expect(screen.getByText('Inline Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill Token Dark Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Inline Code Dark Background')).toBeInTheDocument();
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

  it('places AI and OpenRouter immediately below terminal preferences', () => {
    renderPanel();

    const terminalSection = screen.getByTestId('settings-terminal-section');
    const openRouterSection = screen.getByTestId('settings-openrouter');
    const siblingSections = Array.from(terminalSection.parentElement?.children ?? [])
      .filter((element) => element.hasAttribute('data-testid'));

    expect(siblingSections.indexOf(openRouterSection)).toBe(
      siblingSections.indexOf(terminalSection) + 1,
    );
  });

  it('omits the AI Feature shortcut while keeping its settings available', () => {
    renderPanel();

    expect(
      screen.queryByRole('button', { name: 'Open AI Feature settings' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-openrouter')).toBeInTheDocument();
  });

  it('persists AI Feature default scope and history controls', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    fireEvent.change(screen.getByRole('combobox', { name: 'Default AI scope' }), {
      target: { value: 'workspace' },
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiDefaultScope: 'workspace' }),
    );

    fireEvent.click(screen.getByRole('switch', { name: /Keep local AI history/i }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ aiHistoryEnabled: false }),
    );
  });

  it('persists local-agent disclosure independently immediately after OpenRouter settings', () => {
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    const openRouterSection = screen.getByTestId('settings-openrouter');
    const localAgentSection = screen.getByTestId('settings-local-agents');
    const siblingSections = Array.from(openRouterSection.parentElement?.children ?? [])
      .filter((element) => element.hasAttribute('data-testid'));
    expect(siblingSections.indexOf(localAgentSection)).toBe(
      siblingSections.indexOf(openRouterSection) + 1,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Allow local agent processing' }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        aiCloudDisclosureAccepted: false,
        localAgentDisclosureAccepted: true,
      }),
    );
  });

  it('persists an isolated local-agent executable path', () => {
    const onSettingsChange = vi.fn();
    renderPanel({
      settings: {
        ...DEFAULT_SETTINGS,
        localAgentExecutablePaths: {
          claude: '/existing/claude',
          codex: '',
          opencode: '/existing/opencode',
        },
      },
      onSettingsChange,
    });

    fireEvent.change(screen.getByLabelText('Codex executable path'), {
      target: { value: '/opt/homebrew/bin/codex' },
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        localAgentExecutablePaths: {
          claude: '/existing/claude',
          codex: '/opt/homebrew/bin/codex',
          opencode: '/existing/opencode',
        },
      }),
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
