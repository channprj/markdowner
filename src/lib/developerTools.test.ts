import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setDevtoolsOpenMock = vi.hoisted(() => vi.fn());
const initMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const toggleMock = vi.hoisted(() => vi.fn());

vi.mock('./desktop', () => ({
  setDevtoolsOpen: setDevtoolsOpenMock,
}));

vi.mock('react-grab', () => ({
  init: initMock,
}));

import { applyDeveloperMode, isReactGrabShortcut } from './developerTools';

function keydown(overrides: Record<string, unknown> = {}): KeyboardEvent {
  return {
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    key: 'c',
    code: 'KeyC',
    ...overrides,
  } as unknown as KeyboardEvent;
}

beforeEach(() => {
  setDevtoolsOpenMock.mockReset();
  setDevtoolsOpenMock.mockResolvedValue(undefined);
  disposeMock.mockReset();
  toggleMock.mockReset();
  initMock.mockReset();
  initMock.mockReturnValue({ dispose: disposeMock, toggle: toggleMock });
  delete (window as Window & { __REACT_GRAB_DISABLED__?: boolean })
    .__REACT_GRAB_DISABLED__;
  (window as Window & { __REACT_GRAB__?: unknown }).__REACT_GRAB__ = undefined;
});

afterEach(async () => {
  await applyDeveloperMode(false);
});

describe('React Grab shortcut', () => {
  it('uses Opt+C and tolerates the macOS Option+C key value', () => {
    expect(isReactGrabShortcut(keydown({ altKey: true }))).toBe(true);
    expect(isReactGrabShortcut(keydown({ altKey: true, key: 'ç' }))).toBe(true);
  });

  it('ignores other modifiers and other keys', () => {
    expect(isReactGrabShortcut(keydown())).toBe(false);
    expect(isReactGrabShortcut(keydown({ altKey: true, metaKey: true }))).toBe(
      false,
    );
    expect(isReactGrabShortcut(keydown({ altKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(isReactGrabShortcut(keydown({ altKey: true, key: 'v', code: 'KeyV' }))).toBe(
      false,
    );
  });
});

describe('developer mode', () => {
  it('opens DevTools and starts React Grab with the Opt+C trigger', async () => {
    await applyDeveloperMode(true);

    expect(setDevtoolsOpenMock).toHaveBeenCalledWith(true);
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activationMode: 'toggle',
        allowActivationInsideInput: true,
        telemetry: false,
      }),
    );
    const options = initMock.mock.calls[0][0] as {
      activationKey: (event: KeyboardEvent) => boolean;
    };
    expect(typeof options.activationKey).toBe('function');
    expect(options.activationKey(keydown({ altKey: true }))).toBe(false);
    expect(
      (window as Window & { __REACT_GRAB_DISABLED__?: boolean })
        .__REACT_GRAB_DISABLED__,
    ).toBe(true);
    expect(
      (window as Window & { __REACT_GRAB__?: unknown }).__REACT_GRAB__,
    ).toEqual({ dispose: disposeMock, toggle: toggleMock });
  });

  it('toggles the picker immediately on Opt+C, including inside the editor', async () => {
    await applyDeveloperMode(true);

    const event = new KeyboardEvent('keydown', {
      key: 'ç',
      code: 'KeyC',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(toggleMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }),
    );
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  it('disposes React Grab and closes DevTools when disabled', async () => {
    await applyDeveloperMode(true);
    await applyDeveloperMode(false);

    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(setDevtoolsOpenMock).toHaveBeenLastCalledWith(false);
    expect(
      (window as Window & { __REACT_GRAB__?: unknown }).__REACT_GRAB__,
    ).toBeUndefined();
  });
});
