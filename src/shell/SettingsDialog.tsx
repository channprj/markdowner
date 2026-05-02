import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface Settings {
  autoSave: boolean;
  editorFontSize: number;
  editorFontFamily: string;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Settings>({
    autoSave: false,
    editorFontSize: 14,
    editorFontFamily: '',
  });

  useEffect(() => {
    if (open) {
      invoke<Settings>('load_settings').then(setSettings).catch(console.error);
    }
  }, [open]);

  const handleSettingChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    invoke('save_settings', { settings: newSettings }).catch(console.error);
  };

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
                className="w-24 h-8"
                value={settings.editorFontSize || 14}
                onChange={(e) => handleSettingChange('editorFontSize', parseInt(e.target.value, 10) || 14)}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
