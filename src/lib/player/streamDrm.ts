import {Buffer} from 'buffer';
import type {Drm} from 'react-native-video';
import type {StreamDrm} from '../providers/types';

const HEX_KEY = /^[0-9a-f]{32}$/i;
const base64url = (hex: string) =>
  Buffer.from(hex, 'hex').toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Convert provider data into the player's DRM contract. Never log key material. */
export function getStreamDrm(drm?: StreamDrm): Drm | undefined {
  if (!drm) return undefined;
  if (!['widevine', 'playready', 'clearkey', 'fairplay'].includes(drm.type)) {
    throw new Error('Unsupported DRM type');
  }
  let licenseServer = drm.licenseServer;
  if (drm.clearKeys !== undefined) {
    if (drm.type !== 'clearkey' || licenseServer) {
      throw new Error('Inline ClearKey keys require clearkey DRM without a license server');
    }
    const entries = Object.entries(drm.clearKeys);
    if (!entries.length || entries.some(([id, key]) =>
      !HEX_KEY.test(id) || typeof key !== 'string' || !HEX_KEY.test(key))) {
      throw new Error('ClearKey requires 32-character hexadecimal key IDs and keys');
    }
    const response = JSON.stringify({
      keys: entries.map(([id, key]) => ({kty: 'oct', kid: base64url(id), k: base64url(key)})),
      type: 'temporary',
    });
    licenseServer = `data:application/json;base64,${Buffer.from(response).toString('base64')}`;
  } else if (!licenseServer || !/^https?:\/\//i.test(licenseServer)) {
    throw new Error('DRM requires an HTTP(S) license server or inline ClearKey keys');
  }
  return {
    type: drm.type as Drm['type'],
    licenseServer,
    headers: drm.headers,
    multiDrm: drm.multiDrm,
    contentId: drm.contentId,
    certificateUrl: drm.certificateUrl,
    base64Certificate: drm.base64Certificate,
  };
}
