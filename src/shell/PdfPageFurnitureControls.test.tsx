import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXPORT_PAGE_LAYOUT } from '@/lib/exportPageLayout';

import { PdfPageFurnitureControls } from './PdfPageFurnitureControls';

describe('PdfPageFurnitureControls', () => {
  afterEach(() => cleanup());

  it('emits optional text and independent alignments', () => {
    const onChange = vi.fn();
    render(
      <PdfPageFurnitureControls
        value={DEFAULT_EXPORT_PAGE_LAYOUT}
        disabled={false}
        errorMessage={null}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Header text (optional)'), {
      target: { value: 'Project Atlas' },
    });
    fireEvent.change(screen.getByLabelText('Header alignment'), {
      target: { value: 'left' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ headerText: 'Project Atlas' }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ headerAlignment: 'left' }),
    );
  });

  it('defaults enabled page numbers to bottom-center 1/12', () => {
    const onChange = vi.fn();
    render(
      <PdfPageFurnitureControls
        value={DEFAULT_EXPORT_PAGE_LAYOUT}
        disabled={false}
        errorMessage={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Page numbers' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNumbersEnabled: true,
        pageNumberPosition: 'bottom-center',
        pageNumberFormat: 'page-total',
      }),
    );
  });

  it('shows and validates the Custom template', () => {
    render(
      <PdfPageFurnitureControls
        value={{
          ...DEFAULT_EXPORT_PAGE_LAYOUT,
          pageNumbersEnabled: true,
          pageNumberFormat: 'custom',
          pageNumberTemplate: '{pages}',
        }}
        disabled={false}
        errorMessage="Include {page}."
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('Custom page number template')).toHaveValue(
      '{pages}',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Include {page}.');
  });

  it('offers all formats and six positions with a live sample', () => {
    render(
      <PdfPageFurnitureControls
        value={{ ...DEFAULT_EXPORT_PAGE_LAYOUT, pageNumbersEnabled: true }}
        disabled={false}
        errorMessage={null}
        onChange={() => {}}
      />,
    );

    expect(
      Array.from(
        (screen.getByLabelText('Page number format') as HTMLSelectElement)
          .options,
        (option) => option.value,
      ),
    ).toEqual([
      'page-total',
      'page-total-spaced',
      'page-of-total',
      'page-only',
      'page-label',
      'page-label-of-total',
      'dash-page',
      'custom',
    ]);
    expect(
      Array.from(
        (screen.getByLabelText('Page number position') as HTMLSelectElement)
          .options,
        (option) => option.value,
      ),
    ).toHaveLength(6);
    expect(screen.getByText('Preview · 1/12')).toBeInTheDocument();
  });
});
