import '@testing-library/jest-dom/vitest';

function createZeroDomRect(): DOMRect {
  if (typeof DOMRect !== 'undefined') {
    return new DOMRect(0, 0, 0, 0);
  }

  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function createEmptyDomRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* iterator() {},
  } as DOMRectList;
}

// jsdom ships getContext as a loud "Not implemented" stub unless the optional
// `canvas` package is installed. The minimap draws through a 2D context, so
// give it an inert one — drawing output is verified in the real build, tests
// only need the code path to run without jsdom error spam.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => undefined;
  const stubContext = {
    canvas: null,
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    fillText: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    rect: noop,
    clip: noop,
    measureText: () => ({ width: 0 }),
    font: '',
    fillStyle: '',
    textBaseline: 'top',
    globalAlpha: 1,
  };
  HTMLCanvasElement.prototype.getContext = function getContext(id: string) {
    return id === '2d' ? (stubContext as unknown as CanvasRenderingContext2D) : null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

// jsdom in vitest 4 ships without a writable localStorage by default; install
// a minimal in-memory polyfill so app code that persists state through
// localStorage (sidebar width, theme mode, etc.) can be exercised in tests.
if (typeof window !== 'undefined') {
  // ProseMirror calls Range geometry APIs while scrolling selections into
  // view. jsdom does not implement them, so provide inert geometry for tests.
  if (typeof window.Range !== 'undefined') {
    const rangePrototype = window.Range.prototype as Range & {
      getBoundingClientRect?: () => DOMRect;
      getClientRects?: () => DOMRectList;
    };

    rangePrototype.getBoundingClientRect ??= createZeroDomRect;
    rangePrototype.getClientRects ??= createEmptyDomRectList;
  }

  const requiresPolyfill = (() => {
    try {
      return typeof window.localStorage?.setItem !== 'function';
    } catch {
      return true;
    }
  })();

  if (requiresPolyfill) {
    const store = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key) => (store.has(key) ? store.get(key) ?? null : null),
      key: (index) => Array.from(store.keys())[index] ?? null,
      removeItem: (key) => {
        store.delete(key);
      },
      setItem: (key, value) => {
        store.set(key, String(value));
      },
    };

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }
}
