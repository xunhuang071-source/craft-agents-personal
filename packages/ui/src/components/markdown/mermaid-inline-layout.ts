/** Inline reading scale only; the renderer and expanded view retain natural SVG geometry. */
const READING_SCALE = 14 / 16
const MIN_FIT_SCALE = 12 / 16

export function inlineDiagramLayout(
  dimensions: { width: number; height: number } | null,
  containerWidth: number,
): { scale: number; width: number; height: number; needsScroll: boolean } | null {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0 || containerWidth <= 0) return null
  const fitScale = containerWidth / dimensions.width
  // Fit modest overflow, but keep wide diagrams at the reading scale and scroll
  // rather than shrinking their labels below the 12px equivalent.
  const scale = fitScale >= MIN_FIT_SCALE ? Math.min(READING_SCALE, fitScale) : READING_SCALE
  const width = dimensions.width * scale
  return { scale, width, height: dimensions.height * scale, needsScroll: width > containerWidth }
}
