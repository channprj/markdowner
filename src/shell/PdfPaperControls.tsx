import { useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_CUSTOM_PAPER_MM,
  MIN_CUSTOM_PAPER_MM,
  normalizePdfPaper,
  resolvePdfPaper,
  validateCustomPaperInput,
  type PdfPaper,
  type PdfPaperOrientation,
  type PdfPaperPreset,
} from '@/lib/pdfPaper';

export interface PdfPaperControlsProps {
  value: PdfPaper;
  disabled: boolean;
  onChange: (value: PdfPaper) => void;
  onValidityChange: (valid: boolean) => void;
  idPrefix?: string;
}

const selectClassName =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function formatMillimeters(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export function PdfPaperControls({
  value,
  disabled,
  onChange,
  onValidityChange,
  idPrefix = 'pdf-paper',
}: PdfPaperControlsProps) {
  const [widthInput, setWidthInput] = useState(String(value.paperWidthMm));
  const [heightInput, setHeightInput] = useState(String(value.paperHeightMm));

  useEffect(() => {
    setWidthInput(String(value.paperWidthMm));
  }, [value.paperWidthMm]);

  useEffect(() => {
    setHeightInput(String(value.paperHeightMm));
  }, [value.paperHeightMm]);

  const widthValidation = validateCustomPaperInput(widthInput);
  const heightValidation = validateCustomPaperInput(heightInput);
  const customValid = widthValidation.valid && heightValidation.valid;

  useEffect(() => {
    onValidityChange(value.paperSize !== 'Custom' || customValid);
  }, [customValid, onValidityChange, value.paperSize]);

  const sizeId = `${idPrefix}-size`;
  const widthId = `${idPrefix}-width`;
  const heightId = `${idPrefix}-height`;
  const errorId = `${idPrefix}-error`;
  const resolved = resolvePdfPaper(value);
  const validationMessage = !widthValidation.valid
    ? widthValidation.message
    : !heightValidation.valid
      ? heightValidation.message
      : '';

  const updateCustomDimension = (dimension: 'width' | 'height', rawValue: string) => {
    const nextWidthInput = dimension === 'width' ? rawValue : widthInput;
    const nextHeightInput = dimension === 'height' ? rawValue : heightInput;
    if (dimension === 'width') setWidthInput(rawValue);
    else setHeightInput(rawValue);

    const nextWidth = validateCustomPaperInput(nextWidthInput);
    const nextHeight = validateCustomPaperInput(nextHeightInput);
    const valid = nextWidth.valid && nextHeight.valid;
    onValidityChange(valid);
    if (!valid) return;
    onChange({
      ...normalizePdfPaper(value),
      paperWidthMm: nextWidth.value,
      paperHeightMm: nextHeight.value,
    });
  };

  const selectPaperSize = (paperSize: PdfPaperPreset) => {
    onChange(normalizePdfPaper({ ...value, paperSize }));
    onValidityChange(paperSize !== 'Custom' || customValid);
  };

  const selectOrientation = (paperOrientation: PdfPaperOrientation) => {
    onChange(normalizePdfPaper({ ...value, paperOrientation }));
  };

  const swapDimensions = () => {
    const nextWidthInput = heightInput;
    const nextHeightInput = widthInput;
    setWidthInput(nextWidthInput);
    setHeightInput(nextHeightInput);
    const nextWidth = validateCustomPaperInput(nextWidthInput);
    const nextHeight = validateCustomPaperInput(nextHeightInput);
    const valid = nextWidth.valid && nextHeight.valid;
    onValidityChange(valid);
    if (!valid) return;
    onChange({
      ...normalizePdfPaper(value),
      paperWidthMm: nextWidth.value,
      paperHeightMm: nextHeight.value,
    });
  };

  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="sr-only">PDF paper</legend>
      <div className="grid gap-2">
        <Label htmlFor={sizeId} className="text-xs font-medium text-foreground/85">
          Size
        </Label>
        <select
          id={sizeId}
          aria-label="Size"
          value={value.paperSize}
          disabled={disabled}
          onChange={(event) => selectPaperSize(event.target.value as PdfPaperPreset)}
          className={selectClassName}
        >
          <option value="A4">A4 · 210 × 297 mm</option>
          <option value="A3">A3 · 297 × 420 mm</option>
          <option value="A2">A2 · 420 × 594 mm</option>
          <option value="Letter">Letter · 215.9 × 279.4 mm</option>
          <option value="Custom">Custom</option>
        </select>
      </div>

      {value.paperSize === 'Custom' ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={widthId} className="text-xs text-foreground/85">
                Width
              </Label>
              <div className="relative">
                <Input
                  id={widthId}
                  aria-label="Width"
                  aria-describedby={!widthValidation.valid ? errorId : undefined}
                  aria-invalid={!widthValidation.valid}
                  type="number"
                  min={MIN_CUSTOM_PAPER_MM}
                  max={MAX_CUSTOM_PAPER_MM}
                  step="0.1"
                  inputMode="decimal"
                  value={widthInput}
                  disabled={disabled}
                  onChange={(event) => updateCustomDimension('width', event.target.value)}
                  className="pr-9"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
                  mm
                </span>
              </div>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={heightId} className="text-xs text-foreground/85">
                Height
              </Label>
              <div className="relative">
                <Input
                  id={heightId}
                  aria-label="Height"
                  aria-describedby={!heightValidation.valid ? errorId : undefined}
                  aria-invalid={!heightValidation.valid}
                  type="number"
                  min={MIN_CUSTOM_PAPER_MM}
                  max={MAX_CUSTOM_PAPER_MM}
                  step="0.1"
                  inputMode="decimal"
                  value={heightInput}
                  disabled={disabled}
                  onChange={(event) => updateCustomDimension('height', event.target.value)}
                  className="pr-9"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
                  mm
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Swap width and height"
              title="Swap width and height"
              disabled={disabled}
              onClick={swapDimensions}
            >
              <ArrowLeftRight />
            </Button>
          </div>
          {validationMessage ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {validationMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <div
          role="group"
          aria-label="Orientation"
          className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {(['portrait', 'landscape'] as const).map((orientation) => {
            const label = orientation === 'portrait' ? 'Portrait' : 'Landscape';
            const selected = value.paperOrientation === orientation;
            return (
              <Button
                key={orientation}
                type="button"
                variant={selected ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => selectOrientation(orientation)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}

      <output
        aria-label="Resolved paper size"
        className="text-xs tabular-nums text-muted-foreground"
      >
        {formatMillimeters(resolved.widthMm)} × {formatMillimeters(resolved.heightMm)} mm
      </output>
    </fieldset>
  );
}
