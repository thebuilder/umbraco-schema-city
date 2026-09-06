/** Pixels per world unit for a (1,1,1) orthographic camera. */
export function isometricZoom(
  bounds: { width: number; depth: number },
  viewport: { width: number; height: number },
  buildingHeight: number,
  coveredWidth = 0,
  fill = 0.88
): number {
  const ground = Math.max(4, bounds.width + bounds.depth);
  const projectedWidth = ground / Math.sqrt(2);
  const projectedHeight =
    ground / Math.sqrt(6) + buildingHeight * Math.sqrt(2 / 3);
  return (
    Math.min(
      Math.max(1, viewport.width - coveredWidth) / projectedWidth,
      Math.max(1, viewport.height) / projectedHeight
    ) * fill
  );
}
