# Export Preview Responsive Layout and Zoom Design

## Goal

Keep the PDF Export Preview visibly present at Markdowner's minimum/narrow window width, while adding explicit preview-only zoom controls that let the user inspect the page without changing the exported document.

## Current Failure

At a `760 × 1108` application window, Export Preview switches from the wide two-column layout to a stacked grid. The first row is currently `minmax(220px, auto)`. Because Config contains a long form, its `auto` maximum expands to the form's intrinsic height. The Config row therefore consumes the available editor height and the Preview row collapses below the visible viewport.

The iframe is still mounted and accessible, but no page is visible in the rendered application. This is confusing because the surface is named Export Preview and gives no indication that the preview is merely below an oversized Config region.

## Product Decisions

- Narrow windows use a stacked height split: Config above, Preview below.
- Config and Preview remain visible at the same time; neither becomes a drawer or modal.
- Config owns its vertical scrollbar and cannot grow the grid row to its full intrinsic content height.
- Preview always receives at least `240px` of height at the supported application window sizes.
- Wide windows keep the existing `300px` Config rail and remaining-width Preview layout.
- Zoom controls apply to PDF Preview only. HTML Preview remains a responsive browser-style surface.
- Zoom affects only the rendered Preview page. It does not modify `ExportStyle`, generated HTML, paper size, or the exported PDF.

## Responsive Layout

The Export Preview body keeps one responsive grid:

- Below the existing `lg` breakpoint, use two rows equivalent to `minmax(180px, 2fr) minmax(240px, 3fr)`.
- At and above `lg`, use the existing `300px minmax(0, 1fr)` columns and a single row.
- Apply `min-height: 0` to the grid children so their scroll areas can shrink inside the assigned track.
- Config uses `overflow-y: auto` in both layouts.
- Preview uses its own overflow canvas. Manual zoom can therefore exceed the viewport without affecting Config or the outer application shell.

This preserves the current wide-screen workflow while making the page immediately visible in the known failing `760px`-wide window.

## PDF Page Model

Render the PDF Preview page at a stable base width of `760px`. Derive its base height from the selected paper ratio:

- A4: `760 × (297 / 210)`
- Letter: `760 × (11 / 8.5)`

The preview canvas centers a wrapper that reserves the scaled width and height in normal layout. Inside that wrapper, the base page is transformed from its top-left origin. Reserving the scaled dimensions avoids the empty-space and incorrect-scroll-range problems caused by applying `transform: scale(...)` without a matching layout wrapper, while centering keeps a Fit page visually anchored as the window changes.

The existing sandboxed iframe remains the page content surface. Loading, stale-result protection, preview errors, native-export errors, and busy locking are unchanged.

## Zoom Controls

Place a compact control group at the Preview canvas's upper-right corner:

`−  |  current percentage  |  +  |  Fit`

Behavior:

- A newly opened Export Preview starts in `Fit` mode.
- `Fit` measures the usable Preview canvas with `ResizeObserver` and chooses the smaller of the available-width and available-height ratios.
- `Fit` never enlarges beyond `100%`, but it may shrink below the manual minimum when required to keep the entire page visible.
- `−` and `+` switch to manual mode and move in `10%` increments.
- Manual zoom is clamped to `25–200%`.
- From an irregular Fit percentage, `−` rounds down to the next `10%` step and `+` rounds up to the next `10%` step.
- Manual zoom survives Preview canvas and application-window resizes.
- Selecting `Fit` returns to automatic measurement immediately and continues reacting to later resizes.
- Changing an export style or paper size retains the current zoom mode. Fit mode recomputes for the new page ratio.
- Opening a different Export Preview request resets the zoom mode to Fit.

The percentage is a read-only output, not a third reset action. `Fit` is the single explicit return to automatic sizing.

## Component State and Boundaries

`ExportPreviewTab` owns transient view state:

- `zoomMode: 'fit' | 'manual'`
- manual zoom percentage
- measured Preview viewport width and height

Pure helpers perform clamping, step rounding, base-page sizing, and Fit calculation. Keeping this math outside rendering makes the boundary deterministic and directly testable.

No zoom state is lifted into `App`, persisted to settings, or added to `ExportStyle`. Closing the transient Export Preview tab discards it naturally.

## Accessibility

- Group the controls with the accessible name `Preview zoom controls`.
- Label the buttons `Zoom out`, `Zoom in`, and `Fit preview`.
- Expose the percentage as a named output such as `Preview zoom: 60%`.
- Disable manual decrement/increment at `25%` and `200%` respectively.
- Keep the toolbar outside the iframe so it remains reachable regardless of the preview document contents.
- Do not add undocumented keyboard shortcuts in this change.

## Error and Edge Cases

- If the Preview viewport is not measurable yet, render at a conservative `100%` until the first valid measurement.
- Ignore zero-width or zero-height ResizeObserver entries rather than replacing a valid Fit result with zero.
- Loading and error overlays scale with the page so the state remains spatially tied to the preview sheet.
- Large manual zoom uses the existing Preview canvas scrollbars.
- A native export error stays above the responsive grid and does not consume either Config or Preview track sizing.

## Testing and Verification

Automated tests must cover:

- Fit percentage calculation for width-bound, height-bound, and greater-than-100% viewports.
- Manual `10%` stepping, irregular Fit rounding, and `25–200%` clamping.
- PDF Preview exposes the complete zoom control group and starts in Fit mode.
- Zoom controls change only preview scale and do not change the style passed to `onConfirm`.
- Fit mode reacts to a ResizeObserver update while manual mode preserves its percentage.
- A request change resets to Fit.
- HTML Preview does not expose PDF page zoom controls.
- The narrow responsive grid has bounded Config and guaranteed Preview tracks; the wide layout retains the existing columns.
- Existing loading, preview-error, native-export-error, cancel, busy, preset, and export tests remain green.

Desktop verification must use the installed application at both the reproduced `760 × 1108` window size and the configured minimum `380 × 720` window size and prove:

1. Config and a recognizable PDF page are visible simultaneously.
2. Config scrolls without moving or hiding Preview.
3. Zoom in and zoom out visibly resize the page and update the percentage.
4. Manual zoom remains stable after a window resize.
5. Fit returns the whole page to the available Preview canvas.
6. The minimum-width window still shows a recognizable full page at its automatically calculated Fit percentage.
7. The wide-window layout still shows the Config rail and Preview side by side.

Completion also requires the focused component tests, full Vitest suite, TypeScript checking, production frontend build, `git diff --check`, and a clean review of the final diff.

## Out of Scope

- Persisting a preferred zoom between Export Preview sessions
- Keyboard or trackpad zoom gestures
- Multi-page thumbnail navigation
- Changing PDF pagination or native PDF generation
- Redesigning the export style controls
- Adding zoom controls to HTML Preview
