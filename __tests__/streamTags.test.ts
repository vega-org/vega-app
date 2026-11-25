import {describe, expect, it} from '@jest/globals';
import {splitStreamTags} from '../src/lib/streamTags';

describe('splitStreamTags', () => {
  it('keeps quality and provider tags apart', () => {
    expect(
      splitStreamTags({quality: '1080', tags: ['WEB-DL', 'HEVC']}),
    ).toEqual({quality: '1080', tags: ['WEB-DL', 'HEVC']});
  });

  it('drops a tag that repeats the quality', () => {
    expect(splitStreamTags({quality: '2160', tags: ['2160', 'HDR']})).toEqual({
      quality: '2160',
      tags: ['HDR'],
    });
  });

  it('reads a single tag field', () => {
    expect(splitStreamTags({tag: 'BluRay'})).toEqual({
      quality: undefined,
      tags: ['BluRay'],
    });
  });

  it('ignores blank labels', () => {
    expect(splitStreamTags({quality: '  ', tags: [' ', '']})).toEqual({
      quality: undefined,
      tags: undefined,
    });
  });
});
