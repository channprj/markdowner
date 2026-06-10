import { useEffect, useState } from 'react';
import { Copy, CopyCheck, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CLI_BINARY_INSTALL_PATH,
  CODE_BLOCK_THEMES,
  DEFAULT_SETTINGS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_LINE_HEIGHT_MAX,
  EDITOR_LINE_HEIGHT_MIN,
  EDITOR_LINE_HEIGHT_STEP,
  EDITOR_WRAP_COLUMN_MAX,
  EDITOR_WRAP_COLUMN_MIN,
  OUTLINE_FONT_SIZE_MAX,
  OUTLINE_FONT_SIZE_MIN,
  OUTLINE_ROW_SPACING_MAX,
  OUTLINE_ROW_SPACING_MIN,
  cliBinaryStatus,
  ctrlGLauncherStatus,
  installCliBinary,
  installCtrlGLauncher,
  uninstallCliBinary,
  uninstallCtrlGLauncher,
  type CliBinaryStatus,
  type CodeBlockTheme,
  type CtrlGLauncherStatus,
  type Settings,
} from '@/lib/settings';
import type { UpdateInfo } from '@/lib/updateCheck';

export type { Settings } from '@/lib/settings';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface SettingsPanelProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  /** Resolved choice (system / light / dark) from snapshot + settings. */
  currentTheme: ThemeChoice;
  /** Switches between system tracking and an explicit light/dark theme. */
  onThemeChange: (theme: ThemeChoice) => void;
  updateInfo?: UpdateInfo | null;
  updateActionLabel?: string;
  updateBusy?: boolean;
  updateChecking?: boolean;
  onUpdateAction?: () => void;
  onCheckForUpdate?: () => void;
}

const switchFieldClass = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4';
const inputFieldClass =
  'grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4';
const inputControlClass = 'h-8 w-full min-w-0 sm:max-w-[18rem]';
const toggleFieldClass =
  'grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4';
const toggleGroupClass = 'h-auto w-full min-w-0 flex-wrap justify-start';
const toggleItemClass = 'min-w-0 flex-1 basis-[5.75rem] sm:flex-none sm:basis-auto';
const sectionBodyClass = 'flex flex-col gap-4';
const sectionGroupClass = 'flex flex-col gap-3';

export function SettingsPanel({
  settings,
  onSettingsChange,
  currentTheme,
  onThemeChange,
  updateInfo = null,
  updateActionLabel = 'View release',
  updateBusy = false,
  updateChecking = false,
  onUpdateAction,
  onCheckForUpdate,
}: SettingsPanelProps) {
  const [cliBinary, setCliBinary] = useState<CliBinaryStatus>({
    installPath: CLI_BINARY_INSTALL_PATH,
    targetExecutable: '',
    installed: false,
    inPath: true,
  });
  const [cliBinaryBusy, setCliBinaryBusy] = useState(false);
  const [cliBinaryMessage, setCliBinaryMessage] = useState('');
  const [cliBinaryError, setCliBinaryError] = useState(false);

  const [ctrlGLauncher, setCtrlGLauncher] = useState<CtrlGLauncherStatus>({
    shellConfigPath: '',
    // Mirror the backend's default so the snippet is visible even before the
    // first cliBinary status round-trip resolves (e.g. tests, web preview).
    snippet: 'export EDITOR="mdner"\nexport VISUAL="mdner"',
    installed: false,
  });
  const [ctrlGLauncherBusy, setCtrlGLauncherBusy] = useState(false);
  const [ctrlGLauncherMessage, setCtrlGLauncherMessage] = useState('');
  const [ctrlGLauncherError, setCtrlGLauncherError] = useState(false);
  const [ctrlGSnippetCopied, setCtrlGSnippetCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cliBinaryStatus()
      .then((status) => {
        // Null means the backend isn't reachable (tests, web preview). Keep
        // the default state we initialised with — calling setCliBinary anyway
        // schedules a React update that can race with controlled inputs.
        if (cancelled || status === null) return;
        setCliBinary(status);
      })
      .catch((error) => {
        console.error('Failed to read CLI binary status:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCliBinaryStatus = async () => {
    try {
      const status = await cliBinaryStatus();
      if (status !== null) setCliBinary(status);
    } catch (error) {
      console.error('Failed to refresh CLI binary status:', error);
    }
  };

  const handleInstallCliBinary = async () => {
    setCliBinaryBusy(true);
    setCliBinaryError(false);
    setCliBinaryMessage('');
    try {
      const result = await installCliBinary();
      setCliBinaryMessage(
        result.alreadyDone
          ? `Already installed at ${result.installPath}`
          : `Installed at ${result.installPath}`,
      );
      await refreshCliBinaryStatus();
    } catch (error) {
      const text = typeof error === 'string' ? error : (error as Error)?.message ?? '';
      console.error('Failed to install CLI binary:', error);
      setCliBinaryError(true);
      setCliBinaryMessage(text === 'Cancelled' ? 'Cancelled' : `Install failed: ${text || 'unknown error'}`);
    } finally {
      setCliBinaryBusy(false);
    }
  };

  const handleUninstallCliBinary = async () => {
    setCliBinaryBusy(true);
    setCliBinaryError(false);
    setCliBinaryMessage('');
    try {
      const result = await uninstallCliBinary();
      setCliBinaryMessage(
        result.alreadyDone
          ? `Not installed at ${result.installPath}`
          : `Uninstalled from ${result.installPath}`,
      );
      await refreshCliBinaryStatus();
    } catch (error) {
      const text = typeof error === 'string' ? error : (error as Error)?.message ?? '';
      console.error('Failed to uninstall CLI binary:', error);
      setCliBinaryError(true);
      setCliBinaryMessage(text === 'Cancelled' ? 'Cancelled' : `Uninstall failed: ${text || 'unknown error'}`);
    } finally {
      setCliBinaryBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    ctrlGLauncherStatus()
      .then((status) => {
        if (cancelled || status === null) return;
        setCtrlGLauncher(status);
      })
      .catch((error) => {
        console.error('Failed to read Ctrl+G launcher status:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCtrlGLauncherStatus = async () => {
    try {
      const status = await ctrlGLauncherStatus();
      if (status !== null) setCtrlGLauncher(status);
    } catch (error) {
      console.error('Failed to refresh Ctrl+G launcher status:', error);
    }
  };

  const handleInstallCtrlGLauncher = async () => {
    setCtrlGLauncherBusy(true);
    setCtrlGLauncherError(false);
    setCtrlGLauncherMessage('');
    try {
      const result = await installCtrlGLauncher();
      setCtrlGLauncherMessage(
        result.alreadyDone
          ? `Already in ${result.shellConfigPath}. Open a new terminal to pick it up.`
          : `Added to ${result.shellConfigPath}. Open a new terminal to pick it up.`,
      );
      await refreshCtrlGLauncherStatus();
    } catch (error) {
      const text = typeof error === 'string' ? error : (error as Error)?.message ?? '';
      console.error('Failed to install Ctrl+G launcher:', error);
      setCtrlGLauncherError(true);
      setCtrlGLauncherMessage(`Install failed: ${text || 'unknown error'}`);
    } finally {
      setCtrlGLauncherBusy(false);
    }
  };

  const handleUninstallCtrlGLauncher = async () => {
    setCtrlGLauncherBusy(true);
    setCtrlGLauncherError(false);
    setCtrlGLauncherMessage('');
    try {
      const result = await uninstallCtrlGLauncher();
      setCtrlGLauncherMessage(
        result.alreadyDone
          ? `Not present in ${result.shellConfigPath}`
          : `Removed from ${result.shellConfigPath}. Open a new terminal to drop it.`,
      );
      await refreshCtrlGLauncherStatus();
    } catch (error) {
      const text = typeof error === 'string' ? error : (error as Error)?.message ?? '';
      console.error('Failed to uninstall Ctrl+G launcher:', error);
      setCtrlGLauncherError(true);
      setCtrlGLauncherMessage(`Uninstall failed: ${text || 'unknown error'}`);
    } finally {
      setCtrlGLauncherBusy(false);
    }
  };

  const handleCopyCtrlGSnippet = async () => {
    if (!ctrlGLauncher.snippet) return;
    try {
      await navigator.clipboard.writeText(ctrlGLauncher.snippet);
      setCtrlGSnippetCopied(true);
      // Revert the icon after a moment so the button is reusable without
      // ambiguity if the user copies a second time.
      window.setTimeout(() => setCtrlGSnippetCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy Ctrl+G snippet:', error);
      setCtrlGLauncherError(true);
      setCtrlGLauncherMessage('Copy failed — try selecting the snippet manually.');
    }
  };

  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleBoundedNumberChange = <K extends keyof Settings>(
    key: K,
    rawValue: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const parsed = Number.parseInt(rawValue, 10);
    const nextValue = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
    handleSettingChange(key, nextValue as Settings[K]);
  };

  const fontSizeValue = settings.editorFontSize || DEFAULT_SETTINGS.editorFontSize;
  const lineHeightValue = settings.editorLineHeight || DEFAULT_SETTINGS.editorLineHeight;
  const outlineFontSizeValue = settings.outlineFontSize || DEFAULT_SETTINGS.outlineFontSize;
  const outlineRowSpacingValue =
    settings.outlineRowSpacing ?? DEFAULT_SETTINGS.outlineRowSpacing;

  return (
    <section
      role="region"
      aria-labelledby="settings-panel-heading"
      data-testid="settings-panel"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h2 id="settings-panel-heading" className="text-base font-semibold">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure your Markdowner workspace preferences.
        </p>
      </header>
      <div
        data-testid="settings-panel-body"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className={`mx-auto w-full max-w-2xl px-6 py-6 ${sectionBodyClass}`}>
        <div
          data-testid="settings-app-version"
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-4 py-3"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-tight">Markdowner</span>
            <span className="font-mono text-xs text-muted-foreground">
              v{__APP_VERSION__}
            </span>
            {updateInfo?.available ? (
              <span
                data-testid="settings-update-available"
                className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
              >
                Update available → v{updateInfo.latestVersion}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {updateInfo?.available ? (
              <Button
                type="button"
                size="sm"
                data-testid="settings-update-action"
                onClick={onUpdateAction}
                disabled={updateBusy}
              >
                {updateBusy ? 'Working…' : updateActionLabel}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="settings-update-check"
                onClick={onCheckForUpdate}
                disabled={updateChecking}
              >
                <RefreshCw />
                {updateChecking ? 'Checking…' : 'Check now'}
              </Button>
            )}
            <span
              data-testid="settings-app-version-channel"
              className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
            >
              Beta
            </span>
          </div>
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="update-check-toggle" className="flex flex-col gap-0.5">
            <span className="text-sm font-medium leading-none">Check for updates automatically</span>
            <span className="text-xs text-muted-foreground">
              Looks for a newer release at most once per day — at launch and while
              the app stays running.
            </span>
          </Label>
          <Switch
            id="update-check-toggle"
            data-testid="settings-update-toggle"
            checked={settings.updateCheckEnabled}
            onCheckedChange={(checked) =>
              onSettingsChange({ ...settings, updateCheckEnabled: checked })
            }
          />
        </div>
        <Separator />
        <div data-testid="settings-cli-binary" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium leading-none">CLI Binary (mdner)</h4>
            <span
              data-testid="settings-cli-binary-state"
              className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                cliBinary.installed
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {cliBinary.installed ? 'Installed' : 'Not installed'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Install a <code className="font-mono text-xs">mdner</code> command at{' '}
            <code className="font-mono text-xs">{cliBinary.installPath}</code> so you can run{' '}
            <code className="font-mono text-xs">mdner README.md</code> or{' '}
            <code className="font-mono text-xs">mdner project-folder</code> from the terminal.
            Writing to <code className="font-mono text-xs">/usr/local/bin</code> usually requires an
            administrator password.
          </p>
          <div
            data-testid="settings-cli-binary-path"
            className="min-w-0 overflow-hidden rounded bg-muted px-2 py-1.5"
          >
            <code className="block min-w-0 whitespace-pre-wrap break-all font-mono text-xs leading-5">
              {cliBinary.installPath}
              {cliBinary.targetExecutable ? `  →  ${cliBinary.targetExecutable}` : ''}
            </code>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              size="sm"
              onClick={handleInstallCliBinary}
              disabled={cliBinaryBusy}
              aria-label="Install mdner CLI binary"
              className="flex-1 sm:flex-none"
            >
              <Terminal />
              {cliBinaryBusy
                ? cliBinary.installed
                  ? 'Working…'
                  : 'Installing…'
                : cliBinary.installed
                  ? 'Reinstall'
                  : 'Install'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUninstallCliBinary}
              disabled={cliBinaryBusy || !cliBinary.installed}
              aria-label="Uninstall mdner CLI binary"
              className="flex-1 sm:flex-none"
            >
              <Trash2 />
              Uninstall
            </Button>
          </div>
          {!cliBinary.inPath ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Heads up: <code className="font-mono">/usr/local/bin</code> doesn't appear in your{' '}
              <code className="font-mono">PATH</code>. Add it to your shell rc to use{' '}
              <code className="font-mono">mdner</code> directly.
            </p>
          ) : null}
          <p
            data-testid="settings-cli-binary-status"
            aria-live="polite"
            className={`min-h-5 text-xs ${cliBinaryError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {cliBinaryMessage}
          </p>
        </div>

        <Separator />
        <div data-testid="settings-ctrl-g-launcher" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium leading-none">Ctrl+G Shell Shortcut</h4>
            <span
              data-testid="settings-ctrl-g-launcher-state"
              className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                ctrlGLauncher.installed
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {ctrlGLauncher.installed ? 'Installed' : 'Not installed'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Sets <code className="font-mono text-xs">EDITOR</code> and{' '}
            <code className="font-mono text-xs">VISUAL</code> to{' '}
            <code className="font-mono text-xs">mdner</code> in your shell rc so CLI tools
            (Claude Code, Codex, <code className="font-mono text-xs">git commit</code>, …) open
            Markdowner when you press <code className="font-mono text-xs">Ctrl+G</code> (or
            otherwise spawn your editor). Requires the <code className="font-mono text-xs">mdner</code>{' '}
            CLI Binary above. Use Copy if you'd rather paste it into a different rc file or a
            tool-specific config.
          </p>
          {ctrlGLauncher.snippet ? (
            <div className="flex min-w-0 flex-col gap-2">
              <pre
                data-testid="settings-ctrl-g-launcher-snippet"
                className="min-w-0 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre"
              >
                {ctrlGLauncher.snippet}
              </pre>
              <div className="flex items-center justify-between gap-2">
                <code
                  data-testid="settings-ctrl-g-launcher-path"
                  className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                  title={ctrlGLauncher.shellConfigPath}
                >
                  {ctrlGLauncher.shellConfigPath || '…'}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCtrlGSnippet}
                  aria-label="Copy Ctrl+G shell snippet"
                  data-testid="settings-ctrl-g-launcher-copy"
                  disabled={!ctrlGLauncher.snippet}
                >
                  {ctrlGSnippetCopied ? <CopyCheck /> : <Copy />}
                  {ctrlGSnippetCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              size="sm"
              onClick={handleInstallCtrlGLauncher}
              disabled={ctrlGLauncherBusy}
              aria-label="Install Ctrl+G shell shortcut"
              className="flex-1 sm:flex-none"
            >
              <Terminal />
              {ctrlGLauncherBusy
                ? ctrlGLauncher.installed
                  ? 'Working…'
                  : 'Installing…'
                : ctrlGLauncher.installed
                  ? 'Reinstall'
                  : 'Install'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUninstallCtrlGLauncher}
              disabled={ctrlGLauncherBusy || !ctrlGLauncher.installed}
              aria-label="Uninstall Ctrl+G shell shortcut"
              className="flex-1 sm:flex-none"
            >
              <Trash2 />
              Uninstall
            </Button>
          </div>
          <p
            data-testid="settings-ctrl-g-launcher-status"
            aria-live="polite"
            className={`min-h-5 text-xs ${ctrlGLauncherError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {ctrlGLauncherMessage}
          </p>
        </div>

        <Separator />
        <div className={sectionGroupClass}>
          <h4 className="text-sm font-medium leading-none">Editor Preferences</h4>

          <div className={switchFieldClass}>
            <Label htmlFor="auto-save" className="text-sm">Auto Save</Label>
            <Switch
              id="auto-save"
              checked={settings.autoSave}
              onCheckedChange={(checked) => handleSettingChange('autoSave', checked)}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="font-size" className="text-sm">Font Size</Label>
            <Input
              id="font-size"
              type="number"
              min={EDITOR_FONT_SIZE_MIN}
              max={EDITOR_FONT_SIZE_MAX}
              className={inputControlClass}
              value={fontSizeValue}
              onChange={(event) => {
                handleBoundedNumberChange(
                  'editorFontSize',
                  event.target.value,
                  DEFAULT_SETTINGS.editorFontSize,
                  EDITOR_FONT_SIZE_MIN,
                  EDITOR_FONT_SIZE_MAX,
                );
              }}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="line-height" className="text-sm">Line Height</Label>
            <Input
              id="line-height"
              type="number"
              inputMode="decimal"
              min={EDITOR_LINE_HEIGHT_MIN}
              max={EDITOR_LINE_HEIGHT_MAX}
              step={EDITOR_LINE_HEIGHT_STEP}
              className={inputControlClass}
              value={lineHeightValue}
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value);
                if (!Number.isFinite(parsed)) return;
                const clamped = Math.min(
                  EDITOR_LINE_HEIGHT_MAX,
                  Math.max(EDITOR_LINE_HEIGHT_MIN, parsed),
                );
                handleSettingChange(
                  'editorLineHeight',
                  Math.round(clamped * 10) / 10,
                );
              }}
            />
          </div>

          <div data-testid="settings-field-font-family" className={inputFieldClass}>
            <Label htmlFor="font-family" className="text-sm">Font Family</Label>
            <Input
              id="font-family"
              type="text"
              placeholder="System default"
              className={inputControlClass}
              value={settings.editorFontFamily}
              onChange={(event) => handleSettingChange('editorFontFamily', event.target.value)}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="outline-font-size" className="text-sm">Outline Font Size</Label>
            <Input
              id="outline-font-size"
              type="number"
              min={OUTLINE_FONT_SIZE_MIN}
              max={OUTLINE_FONT_SIZE_MAX}
              className={inputControlClass}
              value={outlineFontSizeValue}
              onChange={(event) => {
                handleBoundedNumberChange(
                  'outlineFontSize',
                  event.target.value,
                  DEFAULT_SETTINGS.outlineFontSize,
                  OUTLINE_FONT_SIZE_MIN,
                  OUTLINE_FONT_SIZE_MAX,
                );
              }}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="outline-row-spacing" className="text-sm">Outline Row Spacing</Label>
            <Input
              id="outline-row-spacing"
              type="number"
              min={OUTLINE_ROW_SPACING_MIN}
              max={OUTLINE_ROW_SPACING_MAX}
              className={inputControlClass}
              value={outlineRowSpacingValue}
              onChange={(event) => {
                handleBoundedNumberChange(
                  'outlineRowSpacing',
                  event.target.value,
                  DEFAULT_SETTINGS.outlineRowSpacing,
                  OUTLINE_ROW_SPACING_MIN,
                  OUTLINE_ROW_SPACING_MAX,
                );
              }}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="asset-folder" className="text-sm">Asset Folder</Label>
            <Input
              id="asset-folder"
              type="text"
              placeholder={DEFAULT_SETTINGS.assetFolder}
              className={inputControlClass}
              value={settings.assetFolder}
              onChange={(event) => {
                const nextValue = event.target.value.trim();
                handleSettingChange(
                  'assetFolder',
                  nextValue.length > 0 ? nextValue : DEFAULT_SETTINGS.assetFolder,
                );
              }}
            />
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="line-wrap" className="text-sm">Word Wrap</Label>
            <Switch
              id="line-wrap"
              checked={settings.editorLineWrap}
              onCheckedChange={(checked) => handleSettingChange('editorLineWrap', checked)}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="wrap-column" className="flex flex-col gap-0.5 text-sm">
              <span>Wrap Column</span>
              <span className="text-xs font-normal text-muted-foreground">
                0 = wrap to window width
              </span>
            </Label>
            <Input
              id="wrap-column"
              type="number"
              inputMode="numeric"
              min={0}
              max={EDITOR_WRAP_COLUMN_MAX}
              step={1}
              disabled={!settings.editorLineWrap}
              value={settings.editorWrapColumn}
              onChange={(event) => {
                const raw = Number.parseInt(event.target.value, 10);
                if (!Number.isFinite(raw)) return;
                // 0 is a valid "wrap to window" value; any other value is
                // clamped to [MIN, MAX].
                const clamped =
                  raw <= 0
                    ? 0
                    : Math.min(EDITOR_WRAP_COLUMN_MAX, Math.max(EDITOR_WRAP_COLUMN_MIN, raw));
                handleSettingChange('editorWrapColumn', clamped);
              }}
              className={inputControlClass}
            />
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="show-wrap-line" className="flex flex-col gap-0.5 text-sm">
              <span>Show Wrap Line</span>
              <span className="text-xs font-normal text-muted-foreground">
                Vertical guide at the wrap column (column &gt; 0 only).
              </span>
            </Label>
            <Switch
              id="show-wrap-line"
              checked={settings.editorShowWrapLine}
              disabled={!settings.editorLineWrap}
              onCheckedChange={(checked) => handleSettingChange('editorShowWrapLine', checked)}
            />
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="focus-mode" className="text-sm">Focus Mode</Label>
            <Switch
              id="focus-mode"
              checked={settings.focusModeEnabled}
              onCheckedChange={(checked) => handleSettingChange('focusModeEnabled', checked)}
            />
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="typewriter-mode" className="text-sm">Typewriter Mode</Label>
            <Switch
              id="typewriter-mode"
              checked={settings.typewriterModeEnabled}
              onCheckedChange={(checked) => handleSettingChange('typewriterModeEnabled', checked)}
            />
          </div>

          <div className={toggleFieldClass}>
            <Label htmlFor="default-mode" className="text-sm">Default Startup Mode</Label>
            <ToggleGroup
              id="default-mode"
              data-testid="settings-default-mode-toggle"
              type="single"
              value={settings.defaultMode}
              onValueChange={(value) => {
                if (!value) return;
                handleSettingChange('defaultMode', value as Settings['defaultMode']);
              }}
              variant="outline"
              size="sm"
              className={toggleGroupClass}
            >
              <ToggleGroupItem
                value="Editor"
                aria-label="Editor"
                title="Editor startup mode"
                className={toggleItemClass}
              >
                Editor
              </ToggleGroupItem>
              <ToggleGroupItem
                value="Wysiwyg"
                aria-label="WYSIWYG"
                title="WYSIWYG startup mode"
                className={toggleItemClass}
              >
                WYSIWYG
              </ToggleGroupItem>
              <ToggleGroupItem
                value="SplitView"
                aria-label="Split View"
                title="Split View startup mode"
                className={toggleItemClass}
              >
                Split View
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className={toggleFieldClass}>
            <Label htmlFor="theme-choice" className="text-sm">Theme</Label>
            <ToggleGroup
              id="theme-choice"
              data-testid="settings-theme-toggle"
              type="single"
              value={currentTheme}
              onValueChange={(value) => {
                if (!value) return;
                onThemeChange(value as ThemeChoice);
              }}
              variant="outline"
              size="sm"
              className={toggleGroupClass}
            >
              <ToggleGroupItem
                value="system"
                aria-label="System"
                title="Follow OS theme"
                className={toggleItemClass}
              >
                System
              </ToggleGroupItem>
              <ToggleGroupItem
                value="light"
                aria-label="Light"
                title="Light theme"
                className={toggleItemClass}
              >
                Light
              </ToggleGroupItem>
              <ToggleGroupItem
                value="dark"
                aria-label="Dark"
                title="Dark theme"
                className={toggleItemClass}
              >
                Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className={toggleFieldClass}>
            <Label htmlFor="pdf-paper-size" className="text-sm">PDF Paper Size</Label>
            <ToggleGroup
              id="pdf-paper-size"
              data-testid="settings-pdf-paper-size-toggle"
              type="single"
              value={settings.pdfPaperSize}
              onValueChange={(value) => {
                if (!value) return;
                handleSettingChange('pdfPaperSize', value as Settings['pdfPaperSize']);
              }}
              variant="outline"
              size="sm"
              className={toggleGroupClass}
            >
              <ToggleGroupItem
                value="A4"
                aria-label="A4"
                title="A4 PDF paper size"
                className={toggleItemClass}
              >
                A4
              </ToggleGroupItem>
              <ToggleGroupItem
                value="Letter"
                aria-label="Letter"
                title="Letter PDF paper size"
                className={toggleItemClass}
              >
                Letter
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="show-minimap" className="text-sm">Show Minimap</Label>
            <Switch
              id="show-minimap"
              checked={settings.showMinimap}
              onCheckedChange={(checked) => handleSettingChange('showMinimap', checked)}
            />
          </div>

          <div className={toggleFieldClass}>
            <Label htmlFor="table-density" className="text-sm">Table Density</Label>
            <ToggleGroup
              id="table-density"
              data-testid="settings-table-density-toggle"
              type="single"
              value={settings.tableDensity}
              onValueChange={(value) => {
                if (!value) return;
                handleSettingChange('tableDensity', value as Settings['tableDensity']);
              }}
              variant="outline"
              size="sm"
              className={toggleGroupClass}
            >
              <ToggleGroupItem
                value="compact"
                aria-label="Compact"
                title="Compact table density"
                className={toggleItemClass}
              >
                Compact
              </ToggleGroupItem>
              <ToggleGroupItem
                value="normal"
                aria-label="Normal"
                title="Normal table density"
                className={toggleItemClass}
              >
                Normal
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className={toggleFieldClass}>
            <Label htmlFor="table-view-mode" className="text-sm">Table View</Label>
            <ToggleGroup
              id="table-view-mode"
              data-testid="settings-table-view-toggle"
              type="single"
              value={settings.tableViewMode}
              onValueChange={(value) => {
                if (!value) return;
                handleSettingChange('tableViewMode', value as Settings['tableViewMode']);
              }}
              variant="outline"
              size="sm"
              className={toggleGroupClass}
            >
              <ToggleGroupItem
                value="normal"
                aria-label="Normal"
                title="Wrap cell text to fit the page width"
                className={toggleItemClass}
              >
                Normal
              </ToggleGroupItem>
              <ToggleGroupItem
                value="inline"
                aria-label="Inline"
                title="Keep each cell on one line; scroll horizontally"
                className={toggleItemClass}
              >
                Inline
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="code-block-highlight" className="text-sm">Code Block Highlighting</Label>
            <Switch
              id="code-block-highlight"
              checked={settings.codeBlockHighlight}
              onCheckedChange={(checked) => handleSettingChange('codeBlockHighlight', checked)}
            />
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="code-block-theme-sync" className="text-sm">Sync Code Block Theme</Label>
            <Switch
              id="code-block-theme-sync"
              checked={settings.codeBlockThemeSync}
              disabled={!settings.codeBlockHighlight}
              onCheckedChange={(checked) => handleSettingChange('codeBlockThemeSync', checked)}
            />
          </div>

          <div className={inputFieldClass}>
            <Label htmlFor="code-block-theme" className="text-sm">Code Block Theme</Label>
            <select
              id="code-block-theme"
              data-testid="settings-code-block-theme"
              value={settings.codeBlockTheme}
              disabled={!settings.codeBlockHighlight}
              onChange={(event) => {
                handleSettingChange(
                  'codeBlockTheme',
                  event.target.value as CodeBlockTheme,
                );
              }}
              className={`${inputControlClass} rounded-md border border-input bg-background px-2 text-sm`}
            >
              {CODE_BLOCK_THEMES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={switchFieldClass}>
            <Label htmlFor="diagnostics-enabled" className="text-sm">Diagnostics Logging</Label>
            <Switch
              id="diagnostics-enabled"
              checked={settings.diagnosticsEnabled}
              onCheckedChange={(checked) => handleSettingChange('diagnosticsEnabled', checked)}
            />
          </div>
        </div>
        </div>
      </div>
      <footer
        data-testid="settings-reset-footer"
        className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-muted/95 px-6 py-3 backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-2xl justify-end">
          <Button
            variant="outline"
            onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}
            title="Reset all editor preferences to factory defaults"
          >
            Reset to Defaults
          </Button>
        </div>
      </footer>
    </section>
  );
}
