type KeyboardLikeEvent = {
  key?: string;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
};

type CompositionState = {
  isComposing: boolean;
  viewComposing?: boolean;
  lastCompositionEndAt?: number;
  now?: number;
};

type DuplicateImeTextInputState = {
  from: number;
  to: number;
  text: string;
  isComposing: boolean;
  lastCompositionEndAt?: number;
  now?: number;
  textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
};

type ProseMirrorResolvedPos = {
  depth: number;
  parentOffset: number;
  parent?: {
    type?: { name?: string };
    textContent?: string;
  };
  before: (depth: number) => number;
};

type ProseMirrorKeyboardView = {
  state?: {
    selection?: {
      $from?: ProseMirrorResolvedPos;
    };
  };
  nodeDOM?: (pos: number) => Node | null;
};

const SYNTHETIC_ENTER_COMPOSITION_WINDOW_MS = 500;
const DUPLICATE_TEXT_INPUT_COMPOSITION_WINDOW_MS = 200;

export function shouldSuppressSyntheticImeEnter(
  event: KeyboardLikeEvent,
  state: CompositionState,
): boolean {
  if (event.key !== 'Enter') return false;
  if (isNativeKeyboardEvent(event)) return false;

  const now = state.now ?? Date.now();
  const lastCompositionEndAt = state.lastCompositionEndAt ?? Number.NEGATIVE_INFINITY;
  return (
    state.isComposing ||
    Boolean(state.viewComposing) ||
    now - lastCompositionEndAt < SYNTHETIC_ENTER_COMPOSITION_WINDOW_MS
  );
}

/**
 * WebKit's Korean IME can dispatch an extra pure insertion immediately after
 * the legitimate replacement that commits a syllable. When the inserted text
 * exactly matches the text before the cursor during the composition window,
 * swallowing it prevents `# 안녕하세요` from becoming `# 안안녕하세요`.
 */
export function shouldSuppressDuplicateImeTextInput(
  state: DuplicateImeTextInputState,
): boolean {
  if (state.from !== state.to || state.text.length === 0) return false;

  const now = state.now ?? Date.now();
  const lastCompositionEndAt = state.lastCompositionEndAt ?? Number.NEGATIVE_INFINITY;
  const isInCompositionWindow =
    state.isComposing ||
    now - lastCompositionEndAt < DUPLICATE_TEXT_INPUT_COMPOSITION_WINDOW_MS;

  if (!isInCompositionWindow) return false;

  const start = Math.max(0, state.from - state.text.length);
  return state.textBetween(start, state.from, '\n', '\n') === state.text;
}

export function focusCodeBlockLanguageSelectorOnArrowUp(
  view: ProseMirrorKeyboardView,
  event: KeyboardLikeEvent,
): boolean {
  if (
    event.key !== 'ArrowUp' ||
    event.altKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return false;
  }

  const $from = view.state?.selection?.$from;
  const parent = $from?.parent;
  if (!parent || parent.type?.name !== 'codeBlock' || !$from) return false;

  const previousText = parent.textContent?.slice(0, $from.parentOffset) ?? '';
  const isAtFirstLine = $from.parentOffset === 0 || !previousText.includes('\n');
  if (!isAtFirstLine) return false;

  const dom = view.nodeDOM?.($from.before($from.depth));
  if (typeof HTMLElement === 'undefined' || !(dom instanceof HTMLElement)) return false;

  const trigger = dom.querySelector('[data-code-block-language-select]');
  if (
    typeof HTMLButtonElement === 'undefined' ||
    !(trigger instanceof HTMLButtonElement) ||
    trigger.disabled
  ) {
    return false;
  }

  event.preventDefault?.();
  trigger.focus();
  return true;
}

function isNativeKeyboardEvent(event: KeyboardLikeEvent): boolean {
  return typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent;
}
