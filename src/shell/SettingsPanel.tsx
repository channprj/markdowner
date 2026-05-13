import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CLI_ALIAS_COMMAND,
  DEFAULT_SETTINGS,
  OUTLINE_FONT_SIZE_MAX,
  OUTLINE_FONT_SIZE_MIN,
  OUTLINE_ROW_SPACING_MAX,
  OUTLINE_ROW_SPACING_MIN,
  installCliLauncher,
  type Settings,
} from '@/lib/settings';

export type { Settings } from '@/lib/settings';

export interface SettingsPanelProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

const switchFieldClass = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4';
const inputFieldClass =
  'grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4';
const inputControlClass = 'h-8 w-full min-w-0 sm:max-w-[18rem]';
const toggleFieldClass =
  'grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4';
const toggleGroupClass = 'h-auto w-full min-w-0 flex-wrap justify-start';
const toggleItemClass = 'min-w-0 flex-1 basis-[5.75rem] sm:flex-none sm:basis-auto';

export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const [aliasCopied, setAliasCopied] = useState(false);
  const [cliLauncherInstalling, setCliLauncherInstalling] = useState(false);
  const [cliLauncherMessage, setCliLauncherMessage] = useState('');
  const [cliLauncherError, setCliLauncherError] = useState(false);

  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleCopyAlias = async () => {
    try {
      await navigator.clipboard.writeText(CLI_ALIAS_COMMAND);
      setAliasCopied(true);
      setCliLauncherError(false);
      setCliLauncherMessage('Copied to clipboard');
      window.setTimeout(() => setAliasCopied(false), 1600);
    } catch (error) {
      console.error('Failed to copy CLI alias:', error);
      setCliLauncherError(true);
      setCliLauncherMessage('Could not copy alias command');
    }
  };

  const handleInstallCliLauncher = async () => {
    setCliLauncherInstalling(true);
    setCliLauncherError(false);
    setCliLauncherMessage('');
    try {
      const result = await installCliLauncher();
      setCliLauncherMessage(
        result.alreadyInstalled
          ? `Already installed in ${result.shellConfigPath}`
          : `Installed in ${result.shellConfigPath}`,
      );
    } catch (error) {
      console.error('Failed to install CLI launcher:', error);
      setCliLauncherError(true);
      setCliLauncherMessage('Could not install CLI launcher');
    } finally {
      setCliLauncherInstalling(false);
    }
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
        className="mx-auto grid w-full max-w-2xl flex-1 gap-4 overflow-y-auto px-6 py-6"
      >
        <div data-testid="settings-cli-launcher" className="grid min-w-0 gap-2">
          <h4 className="text-sm font-medium leading-none">CLI Launcher</h4>
          <p className="text-sm text-muted-foreground">
            Install the markdowner command in your shell config or copy the alias manually.
          </p>
          <div
            data-testid="settings-cli-controls"
            className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start"
          >
            <div
              data-testid="settings-cli-alias-copy"
              className="min-w-0 overflow-hidden rounded bg-muted p-2"
            >
              <code
                data-testid="settings-cli-alias-command"
                className="block min-w-0 whitespace-pre-wrap break-all font-mono text-xs leading-5"
              >
                {CLI_ALIAS_COMMAND}
              </code>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyAlias}
              aria-label="Copy CLI alias command"
              title={aliasCopied ? 'Copied!' : 'Copy alias command'}
              className="w-full sm:w-auto"
            >
              {aliasCopied ? <Check /> : <Copy />}
              Copy
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleInstallCliLauncher}
              disabled={cliLauncherInstalling}
              aria-label="Install CLI Launcher"
              className="w-full sm:w-auto"
            >
              <Terminal />
              {cliLauncherInstalling ? 'Installing' : 'Install'}
            </Button>
          </div>
          <p
            data-testid="settings-cli-launcher-status"
            aria-live="polite"
            className={`min-h-5 text-xs ${cliLauncherError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {cliLauncherMessage}
          </p>
        </div>
        <Separator />
        <div className="grid gap-3">
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
              min={8}
              max={48}
              className={inputControlClass}
              value={fontSizeValue}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                handleSettingChange(
                  'editorFontSize',
                  Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.editorFontSize,
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

          <div className={switchFieldClass}>
            <Label htmlFor="theme-follow-system" className="text-sm">Follow System Theme</Label>
            <Switch
              id="theme-follow-system"
              checked={settings.themeFollowSystem}
              onCheckedChange={(checked) => handleSettingChange('themeFollowSystem', checked)}
            />
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
            <Label htmlFor="diagnostics-enabled" className="text-sm">Diagnostics Logging</Label>
            <Switch
              id="diagnostics-enabled"
              checked={settings.diagnosticsEnabled}
              onCheckedChange={(checked) => handleSettingChange('diagnosticsEnabled', checked)}
            />
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
