import { describe, expect, it } from 'vitest';

import tauriConfig from '../src-tauri/tauri.conf.json';

describe('tauri security config', () => {
  it('defines a non-null CSP baseline for packaged builds', () => {
    expect(tauriConfig.app?.security?.csp).toMatchObject({
      'connect-src': expect.stringContaining('ipc:'),
      'default-src': expect.stringContaining("'self'"),
      'img-src': expect.stringContaining('data:'),
      'style-src': expect.stringContaining("'unsafe-inline'"),
    });
  });

  it('keeps bundled app artifacts enabled for desktop builds', () => {
    expect(tauriConfig.bundle?.active).toBe(true);
  });

  it('targets the macOS app bundle until dmg packaging is configured', () => {
    expect(tauriConfig.bundle?.targets).toBe('app');
  });
});
