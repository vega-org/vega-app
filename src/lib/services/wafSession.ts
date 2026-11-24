// A query's signal survives automatic retries; a fresh user request gets a new
// signal. Remember dismissed operations without permanently blocking a provider.
const dismissed = new WeakSet<AbortSignal>();
const active = new Map<AbortSignal, number>();

export const wafCancelledError = () => new Error('WAF_DIALOG_CANCELLED');

export const registerWafOperation = (scope: AbortSignal): (() => void) => {
  active.set(scope, (active.get(scope) || 0) + 1);
  return () => {
    const count = active.get(scope) || 0;
    if (count <= 1) active.delete(scope);
    else active.set(scope, count - 1);
  };
};

export const dismissWafOperation = (scope?: AbortSignal): void => {
  if (scope) dismissed.add(scope);
};

export const dismissWafOperations = (): void => {
  active.forEach((_, scope) => dismissed.add(scope));
};

export const isWafOperationDismissed = (scope?: AbortSignal): boolean =>
  Boolean(scope && dismissed.has(scope));

// Background work (the next episode's servers loading during playback) must
// not cover the video with a challenge. Its requests fail instead, until the
// guard allows prompting because the user is now waiting for that work.
const promptGuards = new WeakMap<AbortSignal, () => boolean>();

export const guardWafPrompts = (
  scope: AbortSignal,
  canPrompt: () => boolean,
): void => {
  promptGuards.set(scope, canPrompt);
};

export const canPromptWaf = (scope?: AbortSignal): boolean => {
  const canPrompt = scope && promptGuards.get(scope);
  return canPrompt ? canPrompt() : true;
};
