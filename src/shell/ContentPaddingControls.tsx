import { useId } from 'react';

import { Button } from '@/components/ui/button';
import {
  CONTENT_PADDING_MAX,
  CONTENT_PADDING_MIN,
  type ExportPageLayout,
} from '@/lib/exportPageLayout';

import { ExportRangeControl } from './ExportControlPrimitives';

export interface ContentPaddingControlsProps {
  value: ExportPageLayout;
  disabled: boolean;
  onChange: (value: ExportPageLayout) => void;
}

export function ContentPaddingControls({
  value,
  disabled,
  onChange,
}: ContentPaddingControlsProps) {
  const id = useId();
  const emitSide = (
    key:
      | 'contentPaddingTop'
      | 'contentPaddingRight'
      | 'contentPaddingBottom'
      | 'contentPaddingLeft',
    nextValue: number,
  ) => {
    onChange({
      ...value,
      contentPaddingMode: 'individual',
      [key]: nextValue,
    });
  };
  const switchToAll = () => {
    const uniform = value.contentPaddingTop;
    onChange({
      ...value,
      contentPaddingMode: 'all',
      contentPaddingTop: uniform,
      contentPaddingRight: uniform,
      contentPaddingBottom: uniform,
      contentPaddingLeft: uniform,
    });
  };

  return (
    <fieldset className="grid gap-3 border-t border-border pt-4">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Content padding
      </legend>
      <div
        role="group"
        aria-label="Content padding mode"
        className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        <Button
          type="button"
          variant={value.contentPaddingMode === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          aria-label="All sides"
          aria-pressed={value.contentPaddingMode === 'all'}
          disabled={disabled}
          onClick={switchToAll}
        >
          All sides
        </Button>
        <Button
          type="button"
          variant={value.contentPaddingMode === 'individual' ? 'secondary' : 'ghost'}
          size="sm"
          aria-label="Per side"
          aria-pressed={value.contentPaddingMode === 'individual'}
          disabled={disabled}
          onClick={() =>
            onChange({ ...value, contentPaddingMode: 'individual' })
          }
        >
          Per side
        </Button>
      </div>
      {value.contentPaddingMode === 'all' ? (
        <ExportRangeControl
          id={`${id}-all`}
          label="All sides padding"
          value={value.contentPaddingTop}
          min={CONTENT_PADDING_MIN}
          max={CONTENT_PADDING_MAX}
          step={2}
          suffix=" px"
          disabled={disabled}
          onChange={(nextValue) =>
            onChange({
              ...value,
              contentPaddingMode: 'all',
              contentPaddingTop: nextValue,
              contentPaddingRight: nextValue,
              contentPaddingBottom: nextValue,
              contentPaddingLeft: nextValue,
            })
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <ExportRangeControl
            id={`${id}-top`}
            label="Top padding"
            value={value.contentPaddingTop}
            min={CONTENT_PADDING_MIN}
            max={CONTENT_PADDING_MAX}
            step={2}
            suffix=" px"
            disabled={disabled}
            onChange={(nextValue) => emitSide('contentPaddingTop', nextValue)}
          />
          <ExportRangeControl
            id={`${id}-right`}
            label="Right padding"
            value={value.contentPaddingRight}
            min={CONTENT_PADDING_MIN}
            max={CONTENT_PADDING_MAX}
            step={2}
            suffix=" px"
            disabled={disabled}
            onChange={(nextValue) => emitSide('contentPaddingRight', nextValue)}
          />
          <ExportRangeControl
            id={`${id}-bottom`}
            label="Bottom padding"
            value={value.contentPaddingBottom}
            min={CONTENT_PADDING_MIN}
            max={CONTENT_PADDING_MAX}
            step={2}
            suffix=" px"
            disabled={disabled}
            onChange={(nextValue) => emitSide('contentPaddingBottom', nextValue)}
          />
          <ExportRangeControl
            id={`${id}-left`}
            label="Left padding"
            value={value.contentPaddingLeft}
            min={CONTENT_PADDING_MIN}
            max={CONTENT_PADDING_MAX}
            step={2}
            suffix=" px"
            disabled={disabled}
            onChange={(nextValue) => emitSide('contentPaddingLeft', nextValue)}
          />
        </div>
      )}
    </fieldset>
  );
}
