import { describe, expect, it } from 'vitest';

import { shouldShowDefaultAppPrompt, type DefaultMdHandlerStatus } from './defaultApp';

const notDefault: DefaultMdHandlerStatus = {
  supported: true,
  isDefault: false,
  currentHandlerPath: '/System/Applications/TextEdit.app',
};

describe('shouldShowDefaultAppPrompt', () => {
  it('prompts on first launch when not the default handler', () => {
    expect(
      shouldShowDefaultAppPrompt({ promptSeen: false, status: notDefault }),
    ).toBe(true);
  });

  it('never prompts again once seen', () => {
    expect(
      shouldShowDefaultAppPrompt({ promptSeen: true, status: notDefault }),
    ).toBe(false);
  });

  it('skips the prompt when already the default handler', () => {
    expect(
      shouldShowDefaultAppPrompt({
        promptSeen: false,
        status: { ...notDefault, isDefault: true },
      }),
    ).toBe(false);
  });

  it('skips the prompt on unsupported platforms', () => {
    expect(
      shouldShowDefaultAppPrompt({
        promptSeen: false,
        status: { supported: false, isDefault: false, currentHandlerPath: null },
      }),
    ).toBe(false);
  });

  it('skips the prompt when the status query failed', () => {
    expect(shouldShowDefaultAppPrompt({ promptSeen: false, status: null })).toBe(
      false,
    );
  });
});
