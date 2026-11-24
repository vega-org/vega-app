import {create} from 'zustand';
import {settingsStorage} from '../storage/SettingsStorage';
import {dismissWafOperation} from '../services/wafSession';
import {providerAbortError, throwIfProviderAborted} from '../sandbox/abort';

export class VerificationDeniedError extends Error {
  constructor(message = 'Provider verification was cancelled.') {
    super(message);
    this.name = 'VerificationDeniedError';
  }
}

interface ConsentRequest {
  id: number;
  provider: string;
  url: string;
  finish: (allow: boolean, remember?: boolean) => void;
}

export const useVerificationConsentStore = create<{requests: ConsentRequest[]}>(() => ({requests: []}));
let sequence = 0;

/** No website is loaded until the user allows its verification window. */
export async function authorizeVerification(provider: string, url: string, signal?: AbortSignal): Promise<void> {
  throwIfProviderAborted(signal);
  const policy = settingsStorage.getVerificationWindowPolicy();
  if (policy === 'block') throw new VerificationDeniedError('Provider verification windows are blocked in Settings.');
  if (policy === 'allow') return;

  return new Promise((resolve, reject) => {
    const id = ++sequence;
    let settled = false;
    const abort = () => finish(false, false, providerAbortError());
    const finish = (allow: boolean, remember = false, error?: Error) => {
      if (settled) return;
      // Never persist a decision from a request that was already aborted.
      if (signal?.aborted) {allow = false; remember = false; error = providerAbortError();}
      try {
        if (remember) settingsStorage.setVerificationWindowPolicy(allow ? 'allow' : 'block');
      } catch (failure) {
        error = failure instanceof Error ? failure : new Error('Could not save verification permission.');
        allow = false;
      }
      settled = true;
      signal?.removeEventListener('abort', abort);
      useVerificationConsentStore.setState(state => ({requests: state.requests.filter(request => request.id !== id)}));
      if (!allow || settingsStorage.getVerificationWindowPolicy() === 'block') {
        dismissWafOperation(signal);
        reject(error || new VerificationDeniedError());
      } else resolve();
      // The remembered choice is global, including verification requests already queued.
      if (remember && !error) {
        for (const pending of [...useVerificationConsentStore.getState().requests]) pending.finish(allow);
      }
    };
    useVerificationConsentStore.setState(state => ({requests: [...state.requests, {id, provider, url, finish}]}));
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
  });
}
