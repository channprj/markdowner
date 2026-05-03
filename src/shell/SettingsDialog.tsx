import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';

export type { Settings } from '@/lib/settings';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsDialogProps) {
  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const fontSizeValue = settings.editorFontSize || DEFAULT_SETTINGS.editorFontSize;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Markdowner workspace preferences.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <h4 className="text-sm font-medium leading-none">CLI Launcher</h4>
            <p className="text-sm text-muted-foreground">
              To use the markdowner CLI, add this to your shell config:
            </p>
            <pre className="p-2 rounded bg-muted text-xs font-mono">
              alias markdowner="/Applications/Markdowner.app/Contents/MacOS/markdowner"
            </pre>
          </div>
          <Separator />
          <div className="grid gap-2">
            <h4 className="text-sm font-medium leading-none mb-2">Editor Preferences</h4>

            <div className="flex items-center justify-between">
              <Label htmlFor="auto-save" className="text-sm">Auto Save</Label>
              <Switch
                id="auto-save"
                checked={settings.autoSave}
                onCheckedChange={(checked) => handleSettingChange('autoSave', checked)}
              />
            </div>

            <div className="flex items-center justify-between mt-2">
              <Label htmlFor="font-size" className="text-sm">Font Size</Label>
              <Input
                id="font-size"
                type="number"
                min={8}
                max={48}
                className="w-24 h-8"
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

            <div className="flex items-center justify-between mt-2">
              <Label htmlFor="font-family" className="text-sm">Font Family</Label>
              <Input
                id="font-family"
                type="text"
                placeholder="System default"
                className="w-56 h-8"
                value={settings.editorFontFamily}
                onChange={(event) => handleSettingChange('editorFontFamily', event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between mt-2 gap-4">
              <Label htmlFor="asset-folder" className="text-sm">Asset Folder</Label>
              <Input
                id="asset-folder"
                type="text"
                placeholder={DEFAULT_SETTINGS.assetFolder}
                className="w-56 h-8"
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

            <div className="flex items-center justify-between mt-2">
              <Label htmlFor="line-wrap" className="text-sm">Word Wrap</Label>
              <Switch
                id="line-wrap"
                checked={settings.editorLineWrap}
                onCheckedChange={(checked) => handleSettingChange('editorLineWrap', checked)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 mt-2">
              <Label htmlFor="default-mode" className="text-sm">Default Startup Mode</Label>
              <ToggleGroup
                id="default-mode"
                type="single"
                value={settings.defaultMode}
                onValueChange={(value) => {
                  if (!value) return;
                  handleSettingChange('defaultMode', value as Settings['defaultMode']);
                }}
                variant="outline"
                size="sm"
                className="h-8"
              >
                <ToggleGroupItem value="Editor" aria-label="Editor" title="Editor startup mode">
                  Editor
                </ToggleGroupItem>
                <ToggleGroupItem value="Wysiwyg" aria-label="WYSIWYG" title="WYSIWYG startup mode">
                  WYSIWYG
                </ToggleGroupItem>
                <ToggleGroupItem value="SplitView" aria-label="Split View" title="Split View startup mode">
                  Split View
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex items-center justify-between mt-2">
              <Label htmlFor="theme-follow-system" className="text-sm">Follow System Theme</Label>
              <Switch
                id="theme-follow-system"
                checked={settings.themeFollowSystem}
                onCheckedChange={(checked) => handleSettingChange('themeFollowSystem', checked)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onSettingsChange({ ...DEFAULT_SETTINGS })}
            title="Reset all editor preferences to factory defaults"
          >
            Reset to Defaults
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
