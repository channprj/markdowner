import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  PAGE_FURNITURE_TEXT_MAX_LENGTH,
  PAGE_NUMBER_TEMPLATE_MAX_LENGTH,
  formatPageNumber,
  pageNumberTemplateForFormat,
  type ExportPageLayout,
  type PageNumberFormat,
  type PageNumberPosition,
  type PageTextAlignment,
} from '@/lib/exportPageLayout';

export interface PdfPageFurnitureControlsProps {
  value: ExportPageLayout;
  disabled: boolean;
  errorMessage: string | null;
  onChange: (value: ExportPageLayout) => void;
}

const selectClassName =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

const ALIGNMENTS: ReadonlyArray<{
  value: PageTextAlignment;
  label: string;
}> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

const PAGE_NUMBER_FORMATS: ReadonlyArray<{
  value: PageNumberFormat;
  label: string;
}> = [
  { value: 'page-total', label: '1/12' },
  { value: 'page-total-spaced', label: '1 / 12' },
  { value: 'page-of-total', label: '1 of 12' },
  { value: 'page-only', label: '1' },
  { value: 'page-label', label: 'Page 1' },
  { value: 'page-label-of-total', label: 'Page 1 of 12' },
  { value: 'dash-page', label: '– 1 –' },
  { value: 'custom', label: 'Custom' },
];

const PAGE_NUMBER_POSITIONS: ReadonlyArray<{
  value: PageNumberPosition;
  label: string;
}> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export function PdfPageFurnitureControls({
  value,
  disabled,
  errorMessage,
  onChange,
}: PdfPageFurnitureControlsProps) {
  const id = useId();
  const activeTemplate = pageNumberTemplateForFormat(
    value.pageNumberFormat,
    value.pageNumberTemplate,
  );
  const customTemplateId = `${id}-page-number-template`;
  const errorId = `${id}-error`;

  return (
    <fieldset className="grid gap-4 border-t border-border pt-4">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Page furniture
      </legend>

      <div className="grid gap-2">
        <Label
          htmlFor={`${id}-header`}
          className="text-xs font-medium text-foreground/85"
        >
          Header text (optional)
        </Label>
        <Input
          id={`${id}-header`}
          aria-label="Header text (optional)"
          value={value.headerText}
          maxLength={PAGE_FURNITURE_TEXT_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              headerText: event.target.value.slice(
                0,
                PAGE_FURNITURE_TEXT_MAX_LENGTH,
              ),
            })
          }
          placeholder="Shown on every page"
          className="h-8"
        />
        <Label
          htmlFor={`${id}-header-alignment`}
          className="sr-only"
        >
          Header alignment
        </Label>
        <select
          id={`${id}-header-alignment`}
          aria-label="Header alignment"
          value={value.headerAlignment}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              headerAlignment: event.target.value as PageTextAlignment,
            })
          }
          className={selectClassName}
        >
          {ALIGNMENTS.map((alignment) => (
            <option key={alignment.value} value={alignment.value}>
              {alignment.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label
          htmlFor={`${id}-footer`}
          className="text-xs font-medium text-foreground/85"
        >
          Footer text (optional)
        </Label>
        <Input
          id={`${id}-footer`}
          aria-label="Footer text (optional)"
          value={value.footerText}
          maxLength={PAGE_FURNITURE_TEXT_MAX_LENGTH}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              footerText: event.target.value.slice(
                0,
                PAGE_FURNITURE_TEXT_MAX_LENGTH,
              ),
            })
          }
          placeholder="Shown on every page"
          className="h-8"
        />
        <Label
          htmlFor={`${id}-footer-alignment`}
          className="sr-only"
        >
          Footer alignment
        </Label>
        <select
          id={`${id}-footer-alignment`}
          aria-label="Footer alignment"
          value={value.footerAlignment}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              footerAlignment: event.target.value as PageTextAlignment,
            })
          }
          className={selectClassName}
        >
          {ALIGNMENTS.map((alignment) => (
            <option key={alignment.value} value={alignment.value}>
              {alignment.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={`${id}-page-numbers`}
          className="text-xs font-medium text-foreground/85"
        >
          Page numbers
        </Label>
        <Switch
          id={`${id}-page-numbers`}
          aria-label="Page numbers"
          checked={value.pageNumbersEnabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, pageNumbersEnabled: checked })
          }
        />
      </div>

      {value.pageNumbersEnabled ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label
                htmlFor={`${id}-page-number-format`}
                className="text-xs font-medium text-foreground/85"
              >
                Format
              </Label>
              <select
                id={`${id}-page-number-format`}
                aria-label="Page number format"
                value={value.pageNumberFormat}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    pageNumberFormat: event.target.value as PageNumberFormat,
                  })
                }
                className={selectClassName}
              >
                {PAGE_NUMBER_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor={`${id}-page-number-position`}
                className="text-xs font-medium text-foreground/85"
              >
                Position
              </Label>
              <select
                id={`${id}-page-number-position`}
                aria-label="Page number position"
                value={value.pageNumberPosition}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    pageNumberPosition: event.target.value as PageNumberPosition,
                  })
                }
                className={selectClassName}
              >
                {PAGE_NUMBER_POSITIONS.map((position) => (
                  <option key={position.value} value={position.value}>
                    {position.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {value.pageNumberFormat === 'custom' ? (
            <div className="grid gap-2">
              <Label
                htmlFor={customTemplateId}
                className="text-xs font-medium text-foreground/85"
              >
                Custom page number template
              </Label>
              <Input
                id={customTemplateId}
                aria-label="Custom page number template"
                aria-describedby={errorMessage ? errorId : undefined}
                aria-invalid={Boolean(errorMessage)}
                value={value.pageNumberTemplate}
                maxLength={PAGE_NUMBER_TEMPLATE_MAX_LENGTH}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...value, pageNumberTemplate: event.target.value })
                }
                className="h-8 font-mono"
              />
            </div>
          ) : null}

          <output
            aria-live="polite"
            className="rounded-lg bg-muted px-2.5 py-2 font-mono text-xs text-muted-foreground"
          >
            Preview · {formatPageNumber(activeTemplate, 1, 12)}
          </output>
        </div>
      ) : null}

      {errorMessage ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </fieldset>
  );
}
