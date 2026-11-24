import {fitArtworkSize} from '../src/lib/artworkLayout';

it.each([1, 2 / 3, 16 / 9, 3, 1 / 4])('fits artwork with its original ratio %s', ratio => {
  const size = fitArtworkSize(ratio, 320, 260);
  expect(size.width).toBeLessThanOrEqual(320);
  expect(size.height).toBeLessThanOrEqual(260);
  expect(size.width / size.height).toBeCloseTo(ratio);
});

it('fits square channel logos without forcing a portrait crop', () => {
  expect(fitArtworkSize(1, 320, 260)).toEqual({width: 260, height: 260});
});

it('adjusts wide artwork to the available screen width', () => {
  expect(fitArtworkSize(2, 320, 260)).toEqual({width: 320, height: 160});
});
