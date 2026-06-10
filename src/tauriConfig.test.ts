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
    expect(tauriConfig.app?.security?.csp?.['img-src']).toContain('https:');
  });

  it('keeps bundled app artifacts enabled for desktop builds', () => {
    expect(tauriConfig.bundle?.active).toBe(true);
  });

  it('uses ad-hoc macOS signing for no-cost direct distribution builds', () => {
    expect(tauriConfig.bundle?.macOS?.signingIdentity).toBe('-');
  });

  it('keeps the default bundle target as app for local install flows', () => {
    expect(tauriConfig.bundle?.targets).toBe('app');
  });
});
