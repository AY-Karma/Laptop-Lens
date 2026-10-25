const DEFAULT_VISIBLE_POINTS = 180

interface ChartViewport {
  start: number
  count: number
}

export function createChartViewport(rowCount: number, preferredCount = DEFAULT_VISIBLE_POINTS): ChartViewport {
  const safeRowCount = Math.max(0, Math.floor(rowCount))
  const safePreferredCount = Math.max(1, Math.floor(preferredCount))
  const count = Math.min(safeRowCount, safePreferredCount)
  return { start: Math.max(0, safeRowCount - count), count }
}

export function clampViewportStart(start: number, rowCount: number, visibleCount: number): number {
  const safeRowCount = Math.max(0, Math.floor(rowCount))
  const safeVisibleCount = Math.max(0, Math.floor(visibleCount))
  const maxStart = Math.max(0, safeRowCount - safeVisibleCount)
  return Math.max(0, Math.min(maxStart, Number.isFinite(start) ? start : 0))
}

export function shiftViewportStart(
  start: number,
  deltaPoints: number,
  rowCount: number,
  visibleCount: number,
): number {
  return clampViewportStart(start + (Number.isFinite(deltaPoints) ? deltaPoints : 0), rowCount, visibleCount)
}
