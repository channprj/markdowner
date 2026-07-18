import { useId } from 'react';

import { Label } from '@/components/ui/label';
import {
  INLINE_CODE_PRESETS,
  resolveExportTone,
  resolveInlineCodePalette,
  type ExportCodeBlockTheme,
  type InlineCodePreset,
} from '@/lib/exportCodeStyles';
import type { ExportStyle, ExportTheme } from '@/lib/exportDocument';
import {
  CODE_BLOCK_THEMES,
  type CodeBlockTheme,
} from '@/lib/settings';

import { ExportColorControl } from './ExportControlPrimitives';

export interface ExportCodeStyleControlsProps {
  value: ExportStyle;
  appCodeBlockTheme: CodeBlockTheme;
  appTheme: ExportTheme;
  disabled: boolean;
  onChange: (patch: Partial<ExportStyle>) => void;
}

const selectClassName =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function ExportCodeStyleControls({
  value,
  appCodeBlockTheme,
  appTheme,
  disabled,
  onChange,
}: ExportCodeStyleControlsProps) {
  const id = useId();
  const appCodeThemeLabel =
    CODE_BLOCK_THEMES.find((theme) => theme.value === appCodeBlockTheme)?.label ??
    appCodeBlockTheme;
  const tone = resolveExportTone(
    value.preset,
    value.backgroundColor,
    appTheme,
  );

  const chooseInlinePreset = (preset: InlineCodePreset) => {
    if (preset === 'custom') {
      onChange({ inlineCodePreset: preset });
      return;
    }
    const palette = resolveInlineCodePalette(preset, tone, {
      textColor: value.textColor,
      surfaceColor: value.tableHeaderBackgroundColor,
    });
    onChange({
      inlineCodePreset: preset,
      inlineCodeTextColor: palette.textColor,
      inlineCodeBackgroundColor: palette.backgroundColor,
    });
  };

  return (
    <fieldset className="grid gap-4 border-t border-border pt-4">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Code
      </legend>

      <div className="grid gap-2">
        <Label
          htmlFor={`${id}-block-theme`}
          className="text-xs font-medium text-foreground/85"
        >
          Code block theme
        </Label>
        <select
          id={`${id}-block-theme`}
          aria-label="Code block theme"
          value={value.codeBlockTheme}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              codeBlockTheme: event.target.value as ExportCodeBlockTheme,
            })
          }
          className={selectClassName}
        >
          <option value="app">Match app theme — {appCodeThemeLabel}</option>
          {CODE_BLOCK_THEMES.map((theme) => (
            <option key={theme.value} value={theme.value}>
              {theme.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label
          htmlFor={`${id}-inline-preset`}
          className="text-xs font-medium text-foreground/85"
        >
          Inline code preset
        </Label>
        <select
          id={`${id}-inline-preset`}
          aria-label="Inline code preset"
          value={value.inlineCodePreset}
          disabled={disabled}
          onChange={(event) =>
            chooseInlinePreset(event.target.value as InlineCodePreset)
          }
          className={selectClassName}
        >
          {INLINE_CODE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      {value.inlineCodePreset === 'custom' ? (
        <div className="grid grid-cols-2 gap-3">
          <ExportColorControl
            id={`${id}-inline-text`}
            label="Inline code text color"
            value={value.inlineCodeTextColor}
            disabled={disabled}
            onChange={(inlineCodeTextColor) =>
              onChange({ inlineCodePreset: 'custom', inlineCodeTextColor })
            }
          />
          <ExportColorControl
            id={`${id}-inline-background`}
            label="Inline code background color"
            value={value.inlineCodeBackgroundColor}
            disabled={disabled}
            onChange={(inlineCodeBackgroundColor) =>
              onChange({
                inlineCodePreset: 'custom',
                inlineCodeBackgroundColor,
              })
            }
          />
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <span className="mr-2 text-xs text-muted-foreground">Sample</span>
        <code
          className="rounded px-1.5 py-0.5 font-mono text-xs"
          style={{
            color: value.inlineCodeTextColor,
            backgroundColor: value.inlineCodeBackgroundColor,
          }}
        >
          const page = 1
        </code>
      </div>
    </fieldset>
  );
}
