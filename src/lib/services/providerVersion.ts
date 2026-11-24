/** Version stamps detect stale CDN responses; they are not a content signature. */
export class ProviderVersionMismatchError extends Error {
  constructor(fileName: string, detail: string) {
    super(`Provider files are not synchronized: ${fileName}.js ${detail}. Please retry after the source finishes updating.`);
    this.name = 'ProviderVersionMismatchError';
  }
}

export function validateProviderModuleVersion(
  code: string,
  providerValue: string,
  version: string,
  fileName: string,
): boolean {
  const prefix = code.slice(0, 512);
  const header = /^\uFEFF?\/\/ @vega-provider ([A-Za-z0-9_.-]+)\r?\n\/\/ @vega-version ([A-Za-z0-9_.+-]+)(?:\r?\n|$)/.exec(prefix);
  if (!header) {
    if (/@vega-(?:provider|version)\b/.test(prefix)) {
      throw new ProviderVersionMismatchError(fileName, 'has a missing or invalid version header');
    }
    return false;
  }
  if (header[1] !== providerValue || header[2] !== version) {
    throw new ProviderVersionMismatchError(fileName, `belongs to ${header[1]} v${header[2]}, expected ${providerValue} v${version}`);
  }
  return true;
}

export function validateProviderModuleSet(
  modules: Record<string, string>,
  providerValue: string,
  version: string,
): void {
  // A partially propagated deployment must not mix stamped and unstamped files.
  const stamped = Object.entries(modules).map(([name, code]) =>
    validateProviderModuleVersion(code, providerValue, version, name),
  );
  if (stamped.some(Boolean) && stamped.some(value => !value)) {
    throw new ProviderVersionMismatchError('provider', 'contains mixed versioned and unversioned files');
  }
}
