import {getAmbientBars, validAmbientColors, blendAmbientHistory, getAmbientSampleInterval} from '../src/lib/player/ambient';

it('limits the glow to letterbox or pillarbox regions', () => {
  expect(getAmbientBars(1920, 1080, 1920, 800, 'contain')).toEqual({top: 140, bottom: 140, left: 0, right: 0});
  expect(getAmbientBars(1920, 1080, 800, 1080, 'none')).toEqual({top: 0, bottom: 0, left: 560, right: 560});
  expect(getAmbientBars(1920, 1080, 1920, 1080, 'contain')).toEqual({top: 0, bottom: 0, left: 0, right: 0});
});

it('does not overlay the picture when filling the viewport or dimensions are unknown', () => {
  for (const mode of ['cover', 'stretch']) expect(Object.values(getAmbientBars(1920, 1080, 800, 1080, mode))).toEqual([0, 0, 0, 0]);
  for (const value of [0, -1, NaN, Infinity]) expect(Object.values(getAmbientBars(1920, 1080, value, 800, 'contain'))).toEqual([0, 0, 0, 0]);
});

it('accepts only a complete four-color native palette', () => {
  expect(validAmbientColors(['#123456', '#abcdef', '#ABCDEF', '#000000'])).toBe(true);
  for (const value of [null, [], ['red'], ['#000000', '#000000', '#000000', 1]]) expect(validAmbientColors(value)).toBe(false);
});


it('uses a short history that favors the current frame and catches up quickly', () => {
  const black = Array(4).fill('#000000') as [string, string, string, string];
  const white = Array(4).fill('#ffffff') as typeof black;
  expect(blendAmbientHistory(null, white)).toBe(white);
  expect(blendAmbientHistory(black, white)).toEqual(Array(4).fill('#cccccc'));
  expect(blendAmbientHistory(white, white)).toEqual(white);
});

it('coordinates sampling with response speed and bounds the capture rate', () => {
  expect(getAmbientSampleInterval(16)).toBe(33);
  expect(getAmbientSampleInterval(50)).toBe(57);
  expect(getAmbientSampleInterval(220)).toBe(250);
  expect(getAmbientSampleInterval(1000)).toBe(1000);
  expect(getAmbientSampleInterval(-1)).toBe(33);
  expect(getAmbientSampleInterval(5000)).toBe(1000);
  expect(getAmbientSampleInterval(NaN)).toBe(250);
});
