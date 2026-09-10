# Editor popovers covering text

- Symptom: WYSIWYG floating UI obscures the text being written.
- Expected: popovers leave the active editor line visible, including near viewport edges.
- Environment: Markdowner React/Tiptap frontend, macOS, 2026-09-10.
- First seen: user report; previous working version unknown.

| # | Hypothesis | Falsified if | Observed | Verdict |
|---|---|---|---|---|
| 1 | Surface clamping pushes above-line toolbars down over the active line; AI panels have no caret-aware positioning | Edge-clamped toolbar stays outside the line and AI panels track the caret | Toolbar lands at y=108 over line y=110..130; AI panels use fixed bottom positioning | Survived |

## Reproduction

`pnpm exec vitest run src/components/wysiwyg/useEditorSurfaceClamp.test.ts --maxWorkers=1`

Before fix: 1 failed, 5 passed. Expected toolbar top >=138, received 108.
The initial fixture needed a stable ref before this defect-specific failure was observed.

## Diagnosis

- Cause: the surface clamp only enforced editor edges, pushing toolbars over selected text. AI and local-agent panels used a fixed bottom-center position without editor geometry.
- Fix: share above/below placement outside the active line or selection. Track editor scroll, selection, container resizing, and panel content sizing; cap panel height to available space and scroll overflow. Apply the selection-aware clamp to formatting/table toolbars and link popups, and cap slash-menu height.
- Additional browser finding: protecting only the selection head still covered the first selected line. Protect the entire selection when space allows; fall back to the active end for selections spanning most of the viewport. This has a geometry regression test.
- Browser verification: real Tiptap + production React components in a temporary local harness. Verified local-agent and AI panels at middle/bottom caret positions and after agent selection at 960×640. Verified the formatting toolbar moved below a selection at the editor's top edge. All checked active text remained visible. No provider or executable was invoked.
- Falsified: none; edge-clamping and fixed placement were directly observable.
- Blast radius: LocalAgentComposer, AiSelectionPopover, SelectionToolbar, TableToolbar, LinkPopup, SlashCommandMenu.
- Left open: full-screen selections protect the active end because the whole selection leaves no adjacent space for usable controls.
- Instrumentation: temporary browser harness removed after verification; no product probes added.
- Validation: 109 floating-UI tests passed across the focused runs, the complete App suite passed 281 tests after fixing two pre-existing fixtures, and TypeScript checking passed.
