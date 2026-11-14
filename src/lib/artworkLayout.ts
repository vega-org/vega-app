/** Fit artwork within the header without changing its source aspect ratio. */
export function fitArtworkSize(ratio: number, maxWidth: number, maxHeight: number) {
  const aspectRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const width = Math.max(0, Math.min(maxWidth, maxHeight * aspectRatio));
  return {width, height: width / aspectRatio};
}
