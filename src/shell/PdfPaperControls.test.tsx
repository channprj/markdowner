import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PDF_PAPER } from '@/lib/pdfPaper';

import { PdfPaperControls } from './PdfPaperControls';

describe('PdfPaperControls', () => {
  afterEach(() => cleanup());

  it('switches standard size and orientation', () => {
    const onChange = vi.fn();
    render(
      <PdfPaperControls
        value={DEFAULT_PDF_PAPER}
        disabled={false}
        onChange={onChange}
        onValidityChange={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'A3' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ paperSize: 'A3' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ paperOrientation: 'landscape' }),
    );
  });

  it('keeps invalid Custom text visible and reports invalidity', () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <PdfPaperControls
        value={{ ...DEFAULT_PDF_PAPER, paperSize: 'Custom' }}
        disabled={false}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '' } });

    expect(screen.getByLabelText('Width')).toHaveValue(null);
    expect(screen.getByRole('alert')).toHaveTextContent('one decimal place');
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swaps valid Custom dimensions and hides orientation controls', () => {
    const onChange = vi.fn();
    render(
      <PdfPaperControls
        value={{
          ...DEFAULT_PDF_PAPER,
          paperSize: 'Custom',
          paperWidthMm: 180.5,
          paperHeightMm: 240.2,
        }}
        disabled={false}
        onChange={onChange}
        onValidityChange={() => {}}
      />,
    );

    expect(screen.getByText('180.5 × 240.2 mm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Portrait' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Swap width and height' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        paperWidthMm: 240.2,
        paperHeightMm: 180.5,
      }),
    );
  });

  it('shows resolved standard geometry and disables every control while busy', () => {
    render(
      <PdfPaperControls
        value={{
          ...DEFAULT_PDF_PAPER,
          paperSize: 'A3',
          paperOrientation: 'landscape',
        }}
        disabled
        onChange={() => {}}
        onValidityChange={() => {}}
      />,
    );

    expect(screen.getByText('420 × 297 mm')).toBeInTheDocument();
    expect(screen.getByLabelText('Size')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Portrait' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Landscape' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Landscape' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
