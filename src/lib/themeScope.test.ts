import { afterEach, describe, expect, it } from 'vitest';

import {
  applyImportedStylesheet,
  applyThemeSelection,
  resolveOsTheme,
  scopeImportedStylesheet,
} from './themeScope';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.getElementById('markdowner-imported-theme')?.remove();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe('scopeImportedStylesheet', () => {
  it('replaces root selectors with the markdown content scope', () => {
    expect(scopeImportedStylesheet('body, h1 { color: tomato; }')).toBe(
      '.markdowner-content, .markdowner-content h1{ color: tomato; }',
    );
  });

  it('scopes selectors inside nested media queries', () => {
    expect(
      scopeImportedStylesheet('@media (min-width: 768px) { h1, body.dark { color: tomato; } }'),
    ).toBe(
      '@media (min-width: 768px){.markdowner-content h1, .markdowner-content.dark{ color: tomato; }}',
    );
  });
});

describe('applyThemeSelection', () => {
  it('stores the selected theme on the document element', () => {
    applyThemeSelection('BuiltInDark');

    expect(document.documentElement.dataset.theme).toBe('BuiltInDark');
  });
});

describe('resolveOsTheme', () => {
  it('falls back to dark when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    });

    expect(resolveOsTheme()).toBe('BuiltInDark');
  });

  it('returns dark when the OS prefers a dark color scheme', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        expect(query).toBe('(prefers-color-scheme: dark)');
        return {
          matches: true,
        } as MediaQueryList;
      },
    });

    expect(resolveOsTheme()).toBe('BuiltInDark');
  });

  it('returns light when the OS does not prefer a dark color scheme', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
      } as MediaQueryList),
    });

    expect(resolveOsTheme()).toBe('BuiltInLight');
  });
});

describe('applyImportedStylesheet', () => {
  it('creates a scoped imported custom stylesheet', () => {
    applyImportedStylesheet({
      theme: {
        kind: 'CustomCss',
        stylesheet: 'body, h1 { color: tomato; }',
      },
    });

    const style = document.getElementById('markdowner-imported-theme');
    expect(style?.textContent).toBe(
      '.markdowner-content, .markdowner-content h1{ color: tomato; }',
    );
  });

  it('updates an existing imported custom stylesheet', () => {
    applyImportedStylesheet({
      theme: {
        kind: 'CustomCss',
        stylesheet: 'h2 { color: tomato; }',
      },
    });

    applyImportedStylesheet({
      theme: {
        kind: 'CustomCss',
        stylesheet: 'h3 { color: teal; }',
      },
    });

    const styles = document.querySelectorAll('#markdowner-imported-theme');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe('.markdowner-content h3{ color: teal; }');
  });

  it('removes imported styles for built in themes or empty stylesheets', () => {
    applyImportedStylesheet({
      theme: {
        kind: 'CustomCss',
        stylesheet: 'h1 { color: tomato; }',
      },
    });

    applyImportedStylesheet({
      theme: {
        kind: 'BuiltInLight',
        stylesheet: 'h1 { color: tomato; }',
      },
    });

    expect(document.getElementById('markdowner-imported-theme')).toBeNull();

    applyImportedStylesheet({
      theme: {
        kind: 'CustomCss',
        stylesheet: 'h1 { color: tomato; }',
      },
    });

    applyImportedStylesheet({
      theme: {
        kind: 'CustomCss',
        stylesheet: null,
      },
    });

    expect(document.getElementById('markdowner-imported-theme')).toBeNull();
  });
});
