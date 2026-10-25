import { memo, useEffect, useRef } from 'react'
import { backingSize, paintColumn } from '../components/dither-kit/dither-paint'
import { seedOfColor, type DitherColor } from '../components/dither-kit/palette'
import { useChartDimensions } from '../components/dither-kit/use-chart-dimensions'
import './DitherBar.css'

interface DitherBarProps {
  segments: { value: number; color: DitherColor }[]
  scale?: number
  className?: string
  ariaLabel?: string
}

export const DitherBar = memo(function DitherBar({ segments, scale, className = '', ariaLabel }: DitherBarProps) {
  const { ref, size } = useChartDimensions<HTMLSpanElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const bitmap = useRef<ImageData | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element) {
      bitmap.current = null
      return
    }
    if (size.width <= 0 || size.height <= 0) return
    const context = element.getContext('2d')
    if (!context) return

    const { cols, rows } = backingSize(size.width, size.height)
    if (element.width !== cols) element.width = cols
    if (element.height !== rows) element.height = rows
    if (!bitmap.current || bitmap.current.width !== cols || bitmap.current.height !== rows) {
      bitmap.current = context.createImageData(cols, rows)
    }
    const image = bitmap.current
    image.data.fill(0)
    const values = segments.map((segment) => Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0)
    const total = scale ?? values.reduce((sum, value) => sum + value, 0)
    if (!Number.isFinite(total) || total <= 0) {
      context.putImageData(image, 0, 0)
      return
    }

    let start = 0
    let accumulated = 0
    segments.forEach((segment, index) => {
      accumulated += values[index]
      const end = Math.min(cols, Math.round(accumulated / total * cols))
      const seed = seedOfColor(segment.color)
      for (let x = start; x < end; x++) {
        paintColumn(image, x, 0, rows, seed, { variant: 'gradient', intensity: 0, dim: 1, stacked: true })
      }
      start = end
    })
    context.putImageData(image, 0, 0)
  }, [segments, scale, size.width, size.height])

  return (
    <span ref={ref} className={`dither-bar ${className}`} role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      {segments.length > 0 && <canvas ref={canvas} aria-hidden="true" />}
    </span>
  )
}, (previous, next) => previous.scale === next.scale && previous.className === next.className
  && previous.ariaLabel === next.ariaLabel && previous.segments.length === next.segments.length
  && previous.segments.every((segment, index) => segment.value === next.segments[index].value
    && segment.color === next.segments[index].color))
