export interface AppRelease {
  tag_name: string;
  name?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  body?: string | null;
  html_url: string;
  assets?: Array<{name: string; browser_download_url: string}>;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/;
const NIGHTLY_TAG = /^nightly-(\d{8})$/;

function compareVersions(a: RegExpMatchArray, b: RegExpMatchArray, beta: boolean): number {
  for (const index of [1, 2, 3]) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return difference;
  }

  const rank = (suffix?: string) => {
    if (beta && suffix?.startsWith('nightly.')) return 2;
    return suffix ? 0 : 1;
  };
  const difference = rank(a[4]) - rank(b[4]);
  if (difference) return difference;

  const left = a[4]?.split('.') ?? [];
  const right = b[4]?.split('.') ?? [];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const first = left[index];
    const second = right[index];
    if (first === second) continue;
    const firstNumeric = /^\d+$/.test(first);
    const secondNumeric = /^\d+$/.test(second);
    if (firstNumeric && secondNumeric) return Number(first) - Number(second);
    if (firstNumeric !== secondNumeric) return firstNumeric ? -1 : 1;
    return first < second ? -1 : 1;
  }
  return left.length - right.length;
}

export function selectUpdate(
  releases: AppRelease[],
  installedVersion: string,
  beta: boolean,
  isTV: boolean,
): AppRelease | undefined {
  let version = installedVersion.match(VERSION);
  if (!version) return undefined;

  let selected: AppRelease | undefined;
  for (const release of releases) {
    if (!release?.tag_name || release.draft || (!beta && release.prerelease)) continue;

    const nightly = release.tag_name.match(NIGHTLY_TAG);
    let releaseVersion = release.tag_name;
    if (nightly) {
      // The nightly workflow builds phone APKs only.
      if (!beta || isTV) continue;
      const baseVersion = release.name?.match(/^Nightly Build v(\d+\.\d+\.\d+)\b/)?.[1];
      if (!baseVersion) continue;
      releaseVersion = `${baseVersion}-nightly.${nightly[1]}`;
    }

    const candidate = releaseVersion.match(VERSION);
    if (candidate && compareVersions(candidate, version, beta) > 0) {
      selected = release;
      version = candidate;
    }
  }
  return selected;
}
