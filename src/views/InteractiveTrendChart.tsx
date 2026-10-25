import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { clampViewportStart, createChartViewport, shiftViewportStart } from '../chartViewport'
import { ActionIcon } from './ActionIcon'
import { DitherAreaFill } from './DitherAreaFill'
import type { DitherColor } from '../components/dither-kit/palette'

const DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_WIDTH = 1000
const FALLBACK_HEIGHT = 340
const PLOT_TOP = 28
const PLOT_RIGHT = 24
const PLOT_BOTTOM = 48
const DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const DAY_FORMATTER = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })
const MONTH_FORMATTER = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' })
const TIME_FORMATTER = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

type TrendRow = { at: number } & Record<string, number | undefined>

interface TrendLine {
  key: string
  label: string
  color: string
  dashed?: boolean
  connectGaps?: boolean
}

interface TrendMarker {
  at: number
  value: number
  color: string
  label?: string
  description?: string
  comparable?: boolean
}

interface TrendReference {
  value: number
  label: string
  color: string
}

const NO_MARKERS: TrendMarker[] = []
const NO_REFERENCES: TrendReference[] = []

interface InteractiveTrendChartProps {
  rows: TrendRow[]
  lines: TrendLine[]
  valueFormatter: (value: number) => string
  axisFormatter?: (value: number) => string
  differenceFormatter?: (value: number) => string
  differenceLabel?: string
  showDifference?: boolean
  yAxisLabel: string
  includeZero?: boolean
  onReachStart?: () => void
  markers?: TrendMarker[]
  referenceLines?: TrendReference[]
  showArea?: boolean
  ditherColor?: DitherColor
  ditherTo?: string
  appearance?: 'default' | 'minimal' | 'price' | 'insight'
}

interface PanState {
  pointerId: number
  startX: number
  startViewStart: number
  moved: boolean
}

interface ComparisonState {
  markerIndex: number
  targetIndex: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeRows(rows: TrendRow[]): TrendRow[] {
  const byTime = new Map<number, TrendRow>()
  for (const row of [...rows].sort((a, b) => a.at - b.at)) {
    if (Number.isFinite(row.at)) byTime.set(row.at, row)
  }
  return Array.from(byTime.values())
}

function niceStep(range: number, targetTicks = 4): number {
  const rough = Math.max(range / targetTicks, Number.EPSILON)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

function yDomain(values: number[], includeZero: boolean): { min: number; max: number; ticks: number[] } {
  let minimum = values.length ? Math.min(...values) : 0
  let maximum = values.length ? Math.max(...values) : 1
  if (includeZero) {
    minimum = Math.min(0, minimum)
    maximum = Math.max(0, maximum)
  }
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.08, 1)
    minimum -= padding
    maximum += padding
  }
  const step = niceStep(maximum - minimum)
  const niceMin = Math.floor(minimum / step) * step
  const niceMax = Math.ceil(maximum / step) * step
  const ticks: number[] = []
  for (let tick = niceMin; tick <= niceMax + step / 2 && ticks.length < 7; tick += step) ticks.push(Number(tick.toPrecision(12)))
  return { min: niceMin, max: niceMax, ticks }
}

function tickIndices(length: number, maximum = 5): number[] {
  if (length <= 1) return [0]
  const count = Math.min(maximum, length)
  return Array.from(new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1)))))
}

function dateLabel(at: number, span: number): string {
  if (span < 2 * DAY_MS) return TIME_FORMATTER.format(new Date(at))
  if (span > 240 * DAY_MS) return MONTH_FORMATTER.format(new Date(at))
  return DAY_FORMATTER.format(new Date(at))
}

export function InteractiveTrendChart({
  rows,
  showDifference = true,
  lines,
  valueFormatter,
  axisFormatter = valueFormatter,
  differenceFormatter = valueFormatter,
  differenceLabel = 'Difference',
  yAxisLabel,
  includeZero = false,
  onReachStart,
  markers = NO_MARKERS,
  referenceLines = NO_REFERENCES,
  showArea = true,
  ditherColor,
  ditherTo,
  appearance = 'default',
}: InteractiveTrendChartProps) {
  const chartId = useId().replace(/:/g, '')
  const chartRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const panRef = useRef<PanState | null>(null)
  const suppressClickRef = useRef(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [comparison, setComparison] = useState<ComparisonState | null>(null)
  const [viewStartState, setViewStart] = useState<number | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [chartSize, setChartSize] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT })

  useLayoutEffect(() => {
    const chart = chartRef.current
    const svg = svgRef.current
    if (!chart || !svg) return
    const updateSize = () => {
      const bounds = svg.getBoundingClientRect()
      const width = Math.max(1, Math.round(chart.clientWidth))
      const height = Math.max(220, Math.round(bounds.height))
      setChartSize((current) => current.width === width && current.height === height ? current : { width, height })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(chart)
    observer.observe(svg)
    window.addEventListener('resize', updateSize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  const { width: chartWidth, height: chartHeight } = chartSize
  const chartRows = useMemo(() => normalizeRows(rows), [rows])
  const previousRowsRef = useRef(chartRows)
  useLayoutEffect(() => {
    const previous = previousRowsRef.current
    previousRowsRef.current = chartRows
    if (!previous.length || previous[0].at === chartRows[0]?.at) return
    const prependedCount = chartRows.findIndex((row) => row.at === previous[0].at)
    if (prependedCount <= 0) return
    if (panRef.current) panRef.current.startViewStart += prependedCount
    setViewStart((current) => current == null ? null : current + prependedCount)
    setHoveredIndex(null)
  }, [chartRows])
  const references = useMemo(() => referenceLines.filter((line) => Number.isFinite(line.value)), [referenceLines])

  const values = useMemo(
    () => chartRows.flatMap((row) => lines.map((line) => row[line.key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))),
    [chartRows, lines],
  )
  const domain = useMemo(
    () => yDomain([...values, ...markers.filter((marker) => Number.isFinite(marker.at) && Number.isFinite(marker.value)).map((marker) => marker.value), ...references.map((line) => line.value)], includeZero),
    [values, markers, references, includeZero],
  )
  const labels = useMemo(() => domain.ticks.map(axisFormatter), [domain, axisFormatter])
  const isPriceChart = appearance === 'price'
  const isRightScaleChart = isPriceChart || appearance === 'insight'
  const axisWidth = clamp(Math.max(...labels.map((label) => label.length), yAxisLabel.length) * 6.6 + 22, 68, 132)
  const plotLeft = isRightScaleChart ? 22 : axisWidth
  const plotRight = isRightScaleChart ? Math.max(PLOT_RIGHT, axisWidth + 8) : PLOT_RIGHT
  const plotWidth = chartWidth - plotLeft - plotRight
  const plotHeight = chartHeight - PLOT_TOP - PLOT_BOTTOM
  const preferredViewport = createChartViewport(chartRows.length)
  const visiblePointCount = preferredViewport.count
  const maxViewportStart = Math.max(0, chartRows.length - visiblePointCount)
  const viewStart = clampViewportStart(viewStartState ?? preferredViewport.start, chartRows.length, visiblePointCount)
  const visibleStartIndex = chartRows.length ? Math.max(0, Math.floor(viewStart)) : 0
  const visibleEndIndex = chartRows.length ? Math.min(chartRows.length - 1, Math.ceil(viewStart + visiblePointCount - 1)) : -1
  const visibleRows = useMemo(
    () => visibleEndIndex >= visibleStartIndex ? chartRows.slice(visibleStartIndex, visibleEndIndex + 1) : [],
    [chartRows, visibleStartIndex, visibleEndIndex],
  )
  // Include observations across edge gaps; the SVG clip hides offscreen history.
  const { pathStartIndex, pathRows } = useMemo(() => {
    let start = Math.max(0, visibleStartIndex - 1)
    let end = Math.min(chartRows.length - 1, visibleEndIndex + 1)
    for (const line of lines) {
      if (!line.connectGaps) continue
      while (start > 0 && !Number.isFinite(chartRows[start]?.[line.key])) start -= 1
      while (end < chartRows.length - 1 && !Number.isFinite(chartRows[end]?.[line.key])) end += 1
    }
    return { pathStartIndex: start, pathRows: chartRows.slice(start, end + 1) }
  }, [chartRows, lines, visibleStartIndex, visibleEndIndex])
  const firstAt = chartRows[0]?.at ?? 0
  const visibleFirstAt = visibleRows[0]?.at ?? firstAt
  const visibleLastAt = visibleRows[visibleRows.length - 1]?.at ?? visibleFirstAt
  const visibleTimeSpan = Math.max(visibleLastAt - visibleFirstAt, 1)
  const dateTickCount = isRightScaleChart ? clamp(Math.floor(plotWidth / 140) + 1, 2, 5) : chartWidth < 480 ? 3 : 5
  const pointSpacing = plotWidth / Math.max(visiblePointCount - 1, 1)
  const primaryLine = lines[0]
  const secondaryLine = lines[1]
  const { xAtIndex, yAt, linePaths, areaPath, differencePath } = useMemo(() => {
    const domainRange = Math.max(domain.max - domain.min, 1)
    const xAtIndex = (index: number) => visiblePointCount <= 1 ? plotLeft + plotWidth / 2 : plotLeft + ((index - viewStart) / (visiblePointCount - 1)) * plotWidth
    const yAt = (value: number) => PLOT_TOP + (1 - (value - domain.min) / domainRange) * plotHeight
    const pathFor = (line: TrendLine) => {
      let started = false
      return pathRows.flatMap((row, localIndex) => {
        const index = pathStartIndex + localIndex
        const value = row[line.key]
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          if (!line.connectGaps) started = false
          return []
        }
        const command = started ? 'L' : 'M'
        started = true
        return [`${command}${xAtIndex(index).toFixed(1)},${yAt(value).toFixed(1)}`]
      }).join(' ')
    }
    const linePaths = lines.map(pathFor)
    const primaryPoints = primaryLine ? pathRows.map((row, index) => ({ row, index: pathStartIndex + index })).filter(({ row }) => typeof row[primaryLine.key] === 'number') : []
    const areaPath = showArea && primaryLine && primaryPoints.length > 1
      ? `${linePaths[0]} L${xAtIndex(primaryPoints[primaryPoints.length - 1].index).toFixed(1)},${(PLOT_TOP + plotHeight).toFixed(1)} L${xAtIndex(primaryPoints[0].index).toFixed(1)},${(PLOT_TOP + plotHeight).toFixed(1)} Z`
      : ''
    const pairedPoints = primaryLine && secondaryLine
      ? pathRows.map((row, index) => ({ row, index: pathStartIndex + index })).filter(({ row }) => typeof row[primaryLine.key] === 'number' && typeof row[secondaryLine.key] === 'number')
      : []
    const differencePath = appearance !== 'insight' && primaryLine && secondaryLine && pairedPoints.length > 1
      ? `${pairedPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAtIndex(point.index).toFixed(1)},${yAt(point.row[primaryLine.key] as number).toFixed(1)}`).join(' ')} ${[...pairedPoints].reverse().map((point) => `L${xAtIndex(point.index).toFixed(1)},${yAt(point.row[secondaryLine.key] as number).toFixed(1)}`).join(' ')} Z`
      : ''
    return { xAtIndex, yAt, linePaths, areaPath, differencePath }
  }, [pathRows, pathStartIndex, lines, primaryLine, secondaryLine, domain, visiblePointCount, plotLeft, plotWidth, viewStart, plotHeight, showArea, appearance])
  const ditherPoints = useMemo(() => ditherColor && showArea && primaryLine
    ? pathRows.map((row, localIndex) => {
      const index = pathStartIndex + localIndex
      const value = row[primaryLine.key]
      const baseline = ditherTo ? row[ditherTo] : undefined
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      if (ditherTo && (typeof baseline !== 'number' || !Number.isFinite(baseline))) return null
      return { x: xAtIndex(index), y: yAt(value), baselineY: baseline == null ? undefined : yAt(baseline) }
    })
    : [], [ditherColor, ditherTo, showArea, primaryLine, pathRows, pathStartIndex, xAtIndex, yAt])
  const markerPositions = useMemo(
    () => markers.flatMap((marker, markerIndex) => {
      if (!Number.isFinite(marker.at) || !Number.isFinite(marker.value) || chartRows.length === 0) return []
      let nearestIndex = 0
      for (let index = 1; index < chartRows.length; index += 1) {
        if (Math.abs(chartRows[index].at - marker.at) < Math.abs(chartRows[nearestIndex].at - marker.at)) nearestIndex = index
      }
      return [{ ...marker, markerIndex, index: nearestIndex }]
    }),
    [chartRows, markers],
  )
  const hovered = hoveredIndex == null ? null : chartRows[hoveredIndex] ?? null
  const hoverX = hovered && hoveredIndex != null ? xAtIndex(hoveredIndex) : 0
  const tooltipLeft = clamp((hoverX / chartWidth) * 100, 8, 92)
  const tooltipTransform = tooltipLeft > 68 ? 'translateX(-100%)' : tooltipLeft < 28 ? 'translateX(0)' : 'translateX(-50%)'
  const latest = chartRows[chartRows.length - 1]
  const latestPrice = primaryLine ? latest?.[primaryLine.key] : undefined
  const latestPriceY = typeof latestPrice === 'number' && Number.isFinite(latestPrice) ? yAt(latestPrice) : null
  const latestDifference = primaryLine && secondaryLine && typeof latest?.[primaryLine.key] === 'number' && typeof latest?.[secondaryLine.key] === 'number'
    ? (latest[primaryLine.key] as number) - (latest[secondaryLine.key] as number)
    : null
  const previous = chartRows[chartRows.length - 2]
  const latestMovementFor = (key: string): 'up' | 'down' | 'flat' => {
    const latestValue = latest?.[key]
    const previousValue = previous?.[key]
    if (typeof latestValue !== 'number' || typeof previousValue !== 'number' || latestValue === previousValue) return 'flat'
    return latestValue > previousValue ? 'up' : 'down'
  }
  const hasHistoryToPan = maxViewportStart > 0
  const atLatest = viewStart >= maxViewportStart - 0.01
  const comparisonMarker = comparison == null ? null : markerPositions.find((marker) => marker.markerIndex === comparison.markerIndex) ?? null
  const comparisonTarget = comparison?.targetIndex == null ? null : chartRows[comparison.targetIndex] ?? null
  const comparisonTargetValue = comparisonTarget && primaryLine ? comparisonTarget[primaryLine.key] : undefined
  const comparisonDifference = comparisonMarker && typeof comparisonTargetValue === 'number'
    ? comparisonTargetValue - comparisonMarker.value
    : null
  const comparisonPercent = comparisonDifference != null && comparisonMarker && comparisonMarker.value !== 0
    ? (comparisonDifference / comparisonMarker.value) * 100
    : null
  const comparisonDays = comparisonMarker && comparisonTarget
    ? Math.round((comparisonTarget.at - comparisonMarker.at) / DAY_MS)
    : null
  const comparisonTone = comparisonDifference == null ? null : comparisonDifference > 0 ? 'gain' : comparisonDifference < 0 ? 'loss' : 'flat'
  const comparisonAreaPath = useMemo(() => {
    if (!comparisonMarker || comparison?.targetIndex == null || !primaryLine) return ''
    const startIndex = Math.min(comparisonMarker.index, comparison.targetIndex)
    const points = chartRows
      .slice(startIndex, Math.max(comparisonMarker.index, comparison.targetIndex) + 1)
      .map((row, index) => ({ index: startIndex + index, value: row[primaryLine.key] }))
      .filter((point): point is { index: number; value: number } => typeof point.value === 'number' && Number.isFinite(point.value))
    return points.length > 1
      ? `${points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAtIndex(point.index).toFixed(1)},${yAt(point.value).toFixed(1)}`).join(' ')} L${xAtIndex(points[points.length - 1].index).toFixed(1)},${(PLOT_TOP + plotHeight).toFixed(1)} L${xAtIndex(points[0].index).toFixed(1)},${(PLOT_TOP + plotHeight).toFixed(1)} Z`
      : ''
  }, [chartRows, primaryLine, comparisonMarker, comparison?.targetIndex, xAtIndex, yAt, plotHeight])

  const indexAtClientX = (clientX: number, bounds: DOMRect): number => {
    const x = ((clientX - bounds.left) / bounds.width) * chartWidth
    const targetIndex = viewStart + clamp((x - plotLeft) / plotWidth, 0, 1) * Math.max(visiblePointCount - 1, 1)
    return clamp(Math.ceil(targetIndex - 0.5), 0, chartRows.length - 1)
  }

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    if (chartRows.length === 0 || panRef.current || plotWidth <= 0) return
    setHoveredIndex(indexAtClientX(event.clientX, event.currentTarget.getBoundingClientRect()))
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !hasHistoryToPan || pointSpacing <= 0) return
    const onWheel = (event: WheelEvent) => {
      const rawDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
      if (!Number.isFinite(rawDelta) || Math.abs(rawDelta) < 0.01) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? chartWidth : 1
      event.preventDefault()
      setHoveredIndex(null)
      const nextStart = shiftViewportStart(viewStart, rawDelta * scale / pointSpacing, chartRows.length, visiblePointCount)
      setViewStart(nextStart)
      if (nextStart <= 0.01) onReachStart?.()
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [hasHistoryToPan, pointSpacing, chartWidth, viewStart, chartRows.length, visiblePointCount, onReachStart])

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!hasHistoryToPan || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ((event.target as Element).closest('.interactive-trend-marker.is-comparable')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startViewStart: viewStart, moved: false }
    suppressClickRef.current = false
    setHoveredIndex(null)
    setIsPanning(false)
  }

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId || pointSpacing <= 0) return
    const deltaX = event.clientX - pan.startX
    if (!pan.moved && Math.abs(deltaX) < 4) return
    pan.moved = true
    suppressClickRef.current = true
    event.preventDefault()
    setIsPanning(true)
    const nextStart = shiftViewportStart(pan.startViewStart, -deltaX / pointSpacing, chartRows.length, visiblePointCount)
    setViewStart(nextStart)
    if (nextStart === 0 || nextStart === maxViewportStart) {
      pan.startX = event.clientX
      pan.startViewStart = nextStart
    }
    if (nextStart <= 0.01) onReachStart?.()
  }

  const finishPointerPan = (event: PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panRef.current = null
    setIsPanning(false)
  }

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (isPriceChart && chartRows.length > 0) {
      const current = hoveredIndex ?? chartRows.length - 1
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? chartRows.length - 1
        : event.key === 'ArrowLeft' ? current - 1 : event.key === 'ArrowRight' ? current + 1 : null
      if (event.key === 'Escape') setHoveredIndex(null)
      if (next != null) {
        event.preventDefault()
        const index = clamp(next, 0, chartRows.length - 1)
        setHoveredIndex(index)
        if (index < viewStart) setViewStart(index)
        else if (index > viewStart + visiblePointCount - 1) setViewStart(index - visiblePointCount + 1)
      }
      return
    }
    if (!hasHistoryToPan) return
    const step = Math.max(1, visiblePointCount / 10)
    if (event.key === 'Home') {
      event.preventDefault()
      setViewStart(0)
      onReachStart?.()
    } else if (event.key === 'End') {
      event.preventDefault()
      setViewStart(maxViewportStart)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setHoveredIndex(null)
      setViewStart((current) => shiftViewportStart(current ?? preferredViewport.start, event.key === 'ArrowLeft' ? -step : step, chartRows.length, visiblePointCount))
    }
  }

  const onChartClick = (event: MouseEvent<SVGSVGElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!comparison || chartRows.length === 0 || plotWidth <= 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * chartWidth
    const y = ((event.clientY - bounds.top) / bounds.height) * chartHeight
    if (x < plotLeft || x > chartWidth - plotRight || y < PLOT_TOP || y > chartHeight - PLOT_BOTTOM) return
    const targetIndex = indexAtClientX(event.clientX, bounds)
    setComparison({ ...comparison, targetIndex })
    setHoveredIndex(targetIndex)
  }

  const startComparison = (markerIndex: number, index: number) => {
    setComparison({ markerIndex, targetIndex: null })
    setHoveredIndex(index)
  }

  return <div ref={chartRef} className={`interactive-trend-chart interactive-trend-chart--${appearance}${isPanning ? ' is-panning' : ''}${comparison && comparison.targetIndex == null ? ' is-selecting-comparison' : ''}`}>
    <div className="interactive-trend-toolbar">
      <div className="interactive-trend-context">
        <span className="interactive-trend-unit">{yAxisLabel}</span>
        {comparisonMarker && comparisonTarget && comparisonDifference != null && comparisonPercent != null && comparisonDays != null ? <div className="interactive-trend-comparison" role="status">
          <span className="interactive-trend-comparison-period"><strong>{DATE_FORMATTER.format(new Date(comparisonMarker.at))}</strong><span>to</span><strong>{DATE_FORMATTER.format(new Date(comparisonTarget.at))}</strong></span>
          <b className={`interactive-trend-comparison-change ${comparisonDifference >= 0 ? 'up' : 'down'}`}>{comparisonDifference >= 0 ? '▲' : '▼'} {comparisonDifference >= 0 ? '+' : ''}{valueFormatter(comparisonDifference)} <i>({comparisonPercent >= 0 ? '+' : ''}{comparisonPercent.toFixed(2)}%)</i></b>
          <span className="interactive-trend-comparison-duration">{comparisonDays >= 0 ? '+' : ''}{comparisonDays} days</span>
          <button type="button" className="interactive-trend-clear" onClick={() => setComparison(null)} aria-label="Clear price comparison">Clear</button>
        </div> : comparisonMarker ? <span className="interactive-trend-compare-prompt">Select another point on the chart</span> : markers.some((marker) => marker.comparable) ? <span className="interactive-trend-compare-prompt">{isPriceChart ? 'Select buy point to compare' : 'Select the purchase marker to compare'}</span> : null}
      </div>
      <div className="interactive-trend-toolbar-tools">
        {isRightScaleChart && visibleRows.length > 1 && <span className="interactive-trend-period">{DATE_FORMATTER.format(new Date(visibleFirstAt))} - {DATE_FORMATTER.format(new Date(visibleLastAt))}</span>}
        {hasHistoryToPan && <div className="interactive-trend-navigation">
          <span className="interactive-trend-pan-hint">Drag to explore</span>
          <button
            type="button"
            className="interactive-trend-latest"
            onClick={() => { setViewStart(maxViewportStart); setHoveredIndex(null) }}
            disabled={atLatest}
            aria-label={atLatest ? 'Showing latest readings' : 'Jump to latest readings'}
            title={atLatest ? 'You are viewing the latest prices' : 'Jump to the latest prices'}
          ><ActionIcon name="latest" /><span>Latest</span></button>
        </div>}
        <div className="interactive-trend-legend">{lines.map((line) => {
          const latestValue = latest?.[line.key]
          const movement = latestMovementFor(line.key)
          return <span key={line.key} className={`interactive-trend-legend-item interactive-trend-legend-item--${movement}`}>
            <i className="interactive-trend-series-dot" style={{ background: line.color }} />
            <span>{line.label}</span>
            {typeof latestValue === 'number' && <strong><span className="interactive-trend-price-arrow" aria-hidden="true">{movement === 'up' ? '▲' : movement === 'down' ? '▼' : '→'}</span>{valueFormatter(latestValue)}</strong>}
          </span>
        })}{showDifference && latestDifference != null && <span className={latestDifference >= 0 ? 'interactive-trend-difference up' : 'interactive-trend-difference down'}><span>Difference</span><strong>{valueFormatter(latestDifference)}</strong></span>}</div>
      </div>
    </div>
    <svg
      ref={svgRef}
      style={{ width: `${chartWidth}px` }}
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      preserveAspectRatio="none"
      role="img"
      tabIndex={hasHistoryToPan || isPriceChart ? 0 : undefined}
      aria-label={`${yAxisLabel} trend. ${hasHistoryToPan ? 'Drag or swipe horizontally to move through history. ' : ''}${isPriceChart ? 'Move across the chart or use the left and right arrow keys to inspect values. Home and End jump to the first and last values.' : hasHistoryToPan ? 'Use arrow keys, Home, and End to navigate.' : 'Move across the chart to inspect values.'}`}
      onMouseMove={onMove}
      onMouseLeave={() => { if (!panRef.current) setHoveredIndex(null) }}
      onBlur={() => { if (isPriceChart) setHoveredIndex(null) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointerPan}
      onPointerCancel={finishPointerPan}
      onKeyDown={onKeyDown}
      onClick={onChartClick}
    >
      <defs>
        <linearGradient id={`trend-area-${chartId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={primaryLine?.color ?? '#5e6ad2'} stopOpacity="0.22" /><stop offset="100%" stopColor={primaryLine?.color ?? '#5e6ad2'} stopOpacity="0" /></linearGradient>
        <linearGradient id={`comparison-gain-${chartId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#78dba0" stopOpacity="0.3" /><stop offset="100%" stopColor="#78dba0" stopOpacity="0.035" /></linearGradient>
        <linearGradient id={`comparison-loss-${chartId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff8a65" stopOpacity="0.3" /><stop offset="100%" stopColor="#ff8a65" stopOpacity="0.035" /></linearGradient>
        <linearGradient id={`comparison-flat-${chartId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b9b9b4" stopOpacity="0.18" /><stop offset="100%" stopColor="#b9b9b4" stopOpacity="0.025" /></linearGradient>
        <clipPath id={`trend-plot-${chartId}`}><rect x={plotLeft} y={PLOT_TOP} width={plotWidth} height={plotHeight} /></clipPath>
      </defs>
      {domain.ticks.map((tick, index) => <g key={tick}>{appearance !== 'minimal' && <line x1={plotLeft} y1={yAt(tick)} x2={chartWidth - plotRight} y2={yAt(tick)} className={includeZero && Math.abs(tick) < Number.EPSILON ? 'interactive-trend-grid interactive-trend-grid--zero' : 'interactive-trend-grid'} />}<text x={isRightScaleChart ? chartWidth - plotRight + 14 : plotLeft - 12} y={yAt(tick) + 4} textAnchor={isRightScaleChart ? 'start' : 'end'} className="interactive-trend-axis-text">{labels[index]}</text></g>)}
      {appearance === 'default' && <line x1={plotLeft} y1={PLOT_TOP} x2={plotLeft} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-axis" />}
      <line x1={plotLeft} y1={chartHeight - PLOT_BOTTOM} x2={chartWidth - plotRight} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-axis" />
      {visibleRows.length > 0 && tickIndices(visibleRows.length, dateTickCount).map((localIndex) => localIndex + visibleStartIndex).filter((index) => {
        const x = xAtIndex(index)
        return x >= plotLeft - 1 && x <= chartWidth - plotRight + 1
      }).map((index) => <g key={`${chartRows[index]?.at}-${index}`}><line x1={xAtIndex(index)} y1={chartHeight - PLOT_BOTTOM} x2={xAtIndex(index)} y2={chartHeight - PLOT_BOTTOM + 5} className="interactive-trend-axis" /><text x={xAtIndex(index)} y={chartHeight - 18} textAnchor={index === visibleStartIndex ? "start" : index === visibleEndIndex ? "end" : "middle"} className="interactive-trend-axis-text">{dateLabel(chartRows[index]?.at ?? firstAt, visibleTimeSpan)}</text></g>)}
      <g clipPath={`url(#trend-plot-${chartId})`}>
        {areaPath && (ditherColor
          ? <DitherAreaFill points={ditherPoints} x={plotLeft} y={PLOT_TOP} width={plotWidth} height={plotHeight} color={ditherColor} />
          : <path d={areaPath} fill={`url(#trend-area-${chartId})`} className="interactive-trend-area" />)}
        {references.map((line) => <g key={line.label} className="interactive-trend-reference">
          <line x1={plotLeft} y1={yAt(line.value)} x2={chartWidth - plotRight} y2={yAt(line.value)} className="interactive-trend-reference-underlay" />
          <line x1={plotLeft} y1={yAt(line.value)} x2={chartWidth - plotRight} y2={yAt(line.value)} stroke={line.color} className="interactive-trend-reference-line" />
        </g>)}
        {isPriceChart && atLatest && latestPriceY != null && <line x1={plotLeft} y1={latestPriceY} x2={chartWidth - plotRight} y2={latestPriceY} className="interactive-trend-current-line" stroke={primaryLine.color} />}
        {differencePath && <path d={differencePath} className={latestDifference != null && latestDifference < 0 ? 'interactive-trend-gap interactive-trend-gap--loss' : 'interactive-trend-gap interactive-trend-gap--gain'} />}
        {comparisonAreaPath && comparisonMarker && comparison?.targetIndex != null && comparisonTone && <g className={`interactive-trend-comparison-range interactive-trend-comparison-range--${comparisonTone}`}>
          <path d={comparisonAreaPath} fill={`url(#comparison-${comparisonTone}-${chartId})`} className="interactive-trend-comparison-area" />
          <line x1={xAtIndex(comparisonMarker.index)} y1={PLOT_TOP} x2={xAtIndex(comparisonMarker.index)} y2={PLOT_TOP + plotHeight} />
          <line x1={xAtIndex(comparison.targetIndex)} y1={PLOT_TOP} x2={xAtIndex(comparison.targetIndex)} y2={PLOT_TOP + plotHeight} />
        </g>}
        {ditherColor && lines.map((line, index) => <path key={line.key} d={linePaths[index]} className={line.dashed ? 'interactive-trend-line interactive-trend-line--dashed' : 'interactive-trend-line'} style={{ stroke: 'var(--surface-1)', strokeWidth: 5, opacity: 1 }} aria-hidden="true" />)}
        {lines.map((line, index) => <path key={line.key} d={linePaths[index]} className={line.dashed ? 'interactive-trend-line interactive-trend-line--dashed' : 'interactive-trend-line'} stroke={line.color} />)}
        {chartRows.length === 1 && lines.map((line) => {
          const pointValue = chartRows[0][line.key]
          return typeof pointValue === 'number' ? <circle key={line.key} cx={xAtIndex(0)} cy={yAt(pointValue)} r="5" fill={line.color} className="interactive-trend-dot" /> : null
        })}
        {hovered && hoveredIndex != null && <g>{appearance !== 'minimal' && <line x1={hoverX} y1={PLOT_TOP} x2={hoverX} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-hover-line" />}{lines.map((line) => {
          const value = hovered[line.key]
          return typeof value === 'number' && Number.isFinite(value) ? <circle key={line.key} cx={hoverX} cy={yAt(value)} r="5" fill={line.color} className="interactive-trend-dot" /> : null
        })}</g>}
        {comparisonTarget && comparison?.targetIndex != null && typeof comparisonTargetValue === 'number' && comparisonTone && <g className={`interactive-trend-comparison-target interactive-trend-comparison-target--${comparisonTone}`}><circle cx={xAtIndex(comparison.targetIndex)} cy={yAt(comparisonTargetValue)} r="8" /><circle cx={xAtIndex(comparison.targetIndex)} cy={yAt(comparisonTargetValue)} r="3.5" /></g>}
      </g>
      {references.map((line) => {
        const label = `${line.label} ${valueFormatter(line.value)}`
        const width = Math.min(plotWidth - 8, Math.max(100, label.length * 6.4 + 22))
        const y = clamp(yAt(line.value) - 30, PLOT_TOP + 2, PLOT_TOP + plotHeight - 26)
        return <g key={line.label} className="interactive-trend-reference-label" pointerEvents="none">
          <title>{`${line.label}: ${valueFormatter(line.value)}`}</title>
          <rect x={plotLeft + 4} y={y} width={width} height="24" rx="5" />
          <circle cx={plotLeft + 15} cy={y + 12} r="3" fill={line.color} />
          <text x={plotLeft + 24} y={y + 16}>{label}</text>
        </g>
      })}
      {appearance === 'insight' && atLatest && lines.map((line) => {
        const value = latest?.[line.key]
        return typeof value === 'number' && Number.isFinite(value) ? <g key={line.key} className="interactive-trend-endpoint" aria-hidden="true">
          <circle cx={chartWidth - plotRight} cy={yAt(value)} r="9" fill={line.color} fillOpacity="0.15" />
          <circle cx={chartWidth - plotRight} cy={yAt(value)} r="4" fill={line.color} />
        </g> : null
      })}
      {isPriceChart && atLatest && primaryLine && typeof latestPrice === 'number' && latestPriceY != null && <g className="interactive-trend-current" aria-hidden="true">
        <circle cx={chartWidth - plotRight} cy={latestPriceY} r="8" fill={primaryLine.color} fillOpacity="0.2" />
        <circle cx={chartWidth - plotRight} cy={latestPriceY} r="3.5" fill={primaryLine.color} />
        <rect x={chartWidth - plotRight + 4} y={clamp(latestPriceY - 13, PLOT_TOP, chartHeight - PLOT_BOTTOM - 26)} width={plotRight - 8} height="26" rx="5" fill={primaryLine.color} />
        <text x={chartWidth - plotRight + (plotRight / 2)} y={clamp(latestPriceY + 4, PLOT_TOP + 17, chartHeight - PLOT_BOTTOM - 9)} textAnchor="middle">{valueFormatter(latestPrice)}</text>
      </g>}
      {markerPositions.filter((marker) => {
        const x = xAtIndex(marker.index)
        return x >= plotLeft && x <= chartWidth - plotRight
      }).map((marker) => {
        const x = xAtIndex(marker.index)
        const y = yAt(marker.value)
        const label = marker.label ?? 'Marker'
        const labelWidth = clamp(label.length * 6.4 + 20, 68, 132)
        const labelX = clamp(x - labelWidth / 2, plotLeft + 2, chartWidth - plotRight - labelWidth - 2)
        const labelY = y < PLOT_TOP + 44 ? y + 14 : y - 38
        const active = comparison?.markerIndex === marker.markerIndex
        return <g
          key={`${marker.at}-${marker.markerIndex}`}
          className={`interactive-trend-marker${marker.comparable ? ' is-comparable' : ''}${active ? ' is-active' : ''}`}
          role={marker.comparable ? 'button' : undefined}
          tabIndex={marker.comparable ? 0 : undefined}
          aria-label={marker.comparable ? `Compare from ${label}` : label}
          onClick={marker.comparable ? (event) => { event.stopPropagation(); startComparison(marker.markerIndex, marker.index) } : undefined}
          onKeyDown={marker.comparable ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              startComparison(marker.markerIndex, marker.index)
            }
          } : undefined}
        >
          {marker.description && <title>{marker.description}</title>}
          {appearance !== 'minimal' && <line x1={x} y1={PLOT_TOP} x2={x} y2={chartHeight - PLOT_BOTTOM} className="interactive-trend-marker-line" />}
          <circle cx={x} cy={y} r={active ? 8 : 6} fill={marker.color} className="interactive-trend-marker-dot" />
          {marker.label && <g className="interactive-trend-marker-label"><rect x={labelX} y={labelY} width={labelWidth} height="24" rx="12" /><circle cx={labelX + 12} cy={labelY + 12} r="3" fill={marker.color} /><text x={labelX + 21} y={labelY + 15.5}>{marker.label}</text></g>}
        </g>
      })}
    </svg>
    {hovered && <div className="interactive-trend-tooltip" style={{ left: `${tooltipLeft}%`, transform: tooltipTransform }}><strong>{DATE_FORMATTER.format(new Date(hovered.at))}{visibleTimeSpan < 2 * DAY_MS ? ` · ${TIME_FORMATTER.format(new Date(hovered.at))}` : ''}</strong>{lines.map((line) => typeof hovered[line.key] === 'number' ? <span key={line.key}><i style={{ background: line.color }} />{line.label}<b>{valueFormatter(hovered[line.key] as number)}</b></span> : null)}{references.map((line) => <span key={line.label}><i style={{ background: line.color }} />{line.label}<b>{valueFormatter(line.value)}</b></span>)}{showDifference && primaryLine && secondaryLine && typeof hovered[primaryLine.key] === 'number' && typeof hovered[secondaryLine.key] === 'number' && <span className="interactive-trend-tooltip-difference"><i />{differenceLabel}<b>{differenceFormatter((hovered[primaryLine.key] as number) - (hovered[secondaryLine.key] as number))}</b></span>}</div>}
  </div>
}
