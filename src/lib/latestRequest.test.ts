import { describe, expect, it } from 'vitest';

import { createLatestRequestTracker } from './latestRequest';

describe('createLatestRequestTracker', () => {
  it('marks older tokens stale when a newer request starts', () => {
    const tracker = createLatestRequestTracker();

    const first = tracker.begin();
    const second = tracker.begin();

    expect(tracker.current()).toBe(second);
    expect(tracker.isStale(first)).toBe(true);
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isStale(second)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it('creates abort options bound to the token freshness', () => {
    const tracker = createLatestRequestTracker();

    const token = tracker.begin();
    const options = tracker.abortOptions(token);

    expect(options.shouldAbort()).toBe(false);

    tracker.begin();

    expect(options.shouldAbort()).toBe(true);
  });
});
