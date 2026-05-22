export type LatestRequestToken = number;

export type RequestAbortOptions = {
  shouldAbort: () => boolean;
};

export type LatestRequestTracker = {
  begin: () => LatestRequestToken;
  current: () => LatestRequestToken;
  isCurrent: (token: LatestRequestToken) => boolean;
  isStale: (token: LatestRequestToken) => boolean;
  abortOptions: (token: LatestRequestToken) => RequestAbortOptions;
};

export function createLatestRequestTracker(initial = 0): LatestRequestTracker {
  let currentToken = initial;

  const isCurrent = (token: LatestRequestToken) => currentToken === token;

  return {
    begin: () => {
      currentToken += 1;
      return currentToken;
    },
    current: () => currentToken,
    isCurrent,
    isStale: (token) => !isCurrent(token),
    abortOptions: (token) => ({
      shouldAbort: () => !isCurrent(token),
    }),
  };
}
