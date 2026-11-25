import {describe, expect, it} from '@jest/globals';
import {deprecatedProviderKeys} from '../src/lib/providers/deprecatedProviders';
import type {ProviderExtension} from '../src/lib/storage/extensionStorage';

const provider = (
  value: string,
  disabled: boolean,
  author = 'fixture',
): ProviderExtension => ({
  value,
  display_name: value,
  source: {author, url: 'https://example.test'},
  version: '1.0',
  icon: '',
  disabled,
  type: 'global',
  installed: false,
});

describe('deprecatedProviderKeys', () => {
  it('lists only the providers the author disabled', () => {
    const keys = deprecatedProviderKeys([
      provider('live', false),
      provider('gone', true),
    ]);
    expect([...keys]).toEqual(['fixture:gone']);
  });

  it('keys by source author', () => {
    const keys = deprecatedProviderKeys([provider('gone', true, 'other')]);
    expect([...keys]).toEqual(['other:gone']);
  });

  it('falls back to the active author when a provider has none', () => {
    const entry = provider('gone', true);
    const keys = deprecatedProviderKeys(
      [{...entry, source: undefined as never}],
      'active',
    );
    expect([...keys]).toEqual(['active:gone']);
  });

  it('ignores entries without a value', () => {
    const keys = deprecatedProviderKeys([
      {...provider('', true)},
      {...provider('gone', false)},
    ]);
    expect(keys.size).toBe(0);
  });
});
