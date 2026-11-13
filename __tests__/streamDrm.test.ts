import {Buffer} from 'buffer';
import {getStreamDrm} from '../src/lib/player/streamDrm';
import type {StreamDrm} from '../src/lib/providers/types';

const id = '00112233445566778899aabbccddeeff';
const key = 'ffeeddccbbaa99887766554433221100';

describe('provider DRM configuration', () => {
  it('leaves ordinary streams unencrypted', () => {
    expect(getStreamDrm()).toBeUndefined();
  });

  it.each(['widevine', 'playready', 'clearkey', 'fairplay'] as const)(
    'passes %s license configuration and separate headers', type => {
      const drm: StreamDrm = {
        type, licenseServer: 'https://license.example.test/license',
        headers: {Authorization: 'Bearer example'}, multiDrm: true,
        contentId: 'content', certificateUrl: 'https://license.example.test/cert',
        base64Certificate: true,
      };
      expect(getStreamDrm(drm)).toEqual(drm);
    },
  );

  it('converts multiple hex keys into an unpadded base64url JWK response', () => {
    const config = {type: 'clearkey' as const, clearKeys: {[id]: key, [key]: id}};
    const drm = getStreamDrm(JSON.parse(JSON.stringify(config)))!;
    expect(drm.type).toBe('clearkey');
    expect(drm.licenseServer).toMatch(/^data:application\/json;base64,/);
    const response = JSON.parse(Buffer.from(drm.licenseServer!.split(',')[1], 'base64').toString());
    expect(response).toEqual({type: 'temporary', keys: [
      {kty: 'oct', kid: 'ABEiM0RVZneImaq7zN3u_w', k: '_-7dzLuqmYh3ZlVEMyIRAA'},
      {kty: 'oct', kid: '_-7dzLuqmYh3ZlVEMyIRAA', k: 'ABEiM0RVZneImaq7zN3u_w'},
    ]});
    expect(config.clearKeys[id]).toBe(key);
  });

  it.each([{}, {[id]: 'bad'}, {bad: key}, {[id]: `${key}00`}])(
    'rejects malformed keys without exposing their values', clearKeys => {
      expect(() => getStreamDrm({type: 'clearkey', clearKeys})).toThrow(
        'ClearKey requires 32-character hexadecimal key IDs and keys',
      );
    },
  );

  it('rejects conflicting configuration and unsupported types', () => {
    expect(() => getStreamDrm({type: 'widevine', clearKeys: {[id]: key}})).toThrow('Inline ClearKey');
    expect(() => getStreamDrm({type: 'clearkey', clearKeys: {[id]: key}, licenseServer: 'https://example.test'})).toThrow('Inline ClearKey');
    expect(() => getStreamDrm({type: 'unknown'} as unknown as StreamDrm)).toThrow('Unsupported DRM');
  });

  it.each([undefined, '', 'file:///license', 'data:application/json;base64,e30='])(
    'requires an HTTP(S) license endpoint when inline keys are absent', licenseServer => {
      expect(() => getStreamDrm({type: 'widevine', licenseServer})).toThrow('HTTP(S)');
    },
  );
});
