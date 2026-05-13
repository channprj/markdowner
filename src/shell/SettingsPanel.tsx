import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DEFAULT_SETTINGS,
  OUTLINE_FONT_SIZE_MAX,
  OUTLINE_FONT_SIZE_MIN,
  OUTLINE_ROW_SPACING_MAX,
  OUTLINE_ROW_SPACING_MIN,
  type Settings,
} from '@/lib/settings';

export type { Settings } from '@/lib/settings';

export interface SettingsPanelProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

const CLI_ALIAS_COMMAND =
  'alias markdowner="/Applications/Markdowner.app/Contents/MacOS/markdowner"';

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

  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleCopyAlias = async () => {
    try {
      await navigator.clipboard.writeText(CLI_ALIAS_COMMAND);
      setAliasCopied(true);
      window.setTimeout(() => setAliasCopied(false), 1600);
    } catch (error) {
      console.error('Failed to copy CLI alias:', error);
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
        <div className="grid gap-2">
          <h4 className="text-sm font-medium leading-none">CLI Launcher</h4>
          <p className="text-sm text-muted-foreground">
            To use the markdowner CLI, add this to your shell config:
          </p>
          <button
            type="button"
            onClick={handleCopyAlias}
            aria-label="Copy CLI alias command"
            title={aliasCopied ? 'Copied!' : 'Click to copy'}
            data-testid="settings-cli-alias-copy"
            className="group relative flex w-full items-start justify-between gap-2 rounded bg-muted p-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs">
              {CLI_ALIAS_COMMAND}
            </code>
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            >
              {aliasCopied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="sr-only" aria-live="polite">
              {aliasCopied ? 'Copied to clipboard' : ''}
            </span>
          </button>
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
