import { describe, expect, it } from 'vitest';

import { scopeImportedStylesheet } from './themeScope';

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
