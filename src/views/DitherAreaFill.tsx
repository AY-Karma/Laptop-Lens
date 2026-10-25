import { memo, useEffect, useRef } from 'react'
import { backingSize, paintColumn } from '../components/dither-kit/dither-paint'
import { seedOfColor, type DitherColor } from '../components/dither-kit/palette'
import './DitherAreaFill.css'

export interface DitherPoint { x: number; y: number; baselineY?: number }

interface DitherAreaFillProps {
  points: (DitherPoint | null)[]
  x: number
  y: number
  width: number
  height: number
  color: DitherColor
}

export const DitherAreaFill = memo(function DitherAreaFill({ points, x, y, width, height, color }: DitherAreaFillProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const bitmap = useRef<ImageData | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element || width <= 0 || height <= 0) return
    const context = element.getContext('2d')
    if (!context) return
    const { cols, rows } = backingSize(width, height)
    if (element.width !== cols) element.width = cols
    if (element.height !== rows) element.height = rows
    if (!bitmap.current || bitmap.current.width !== cols || bitmap.current.height !== rows) {
      bitmap.current = context.createImageData(cols, rows)
    }
    const image = bitmap.current
    image.data.fill(0)
    const seed = seedOfColor(color)
    let paintedThrough = -1

    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1]
      const current = points[i]
      if (!previous || !current || current.x <= previous.x) continue
      const firstColumn = Math.max(paintedThrough + 1, 0, Math.ceil((previous.x - x) / width * (cols - 1)))
      const lastColumn = Math.min(cols - 1, Math.floor((current.x - x) / width * (cols - 1)))
      for (let column = firstColumn; column <= lastColumn; column++) {
        const at = x + column / (cols - 1) * width
        const fraction = (at - previous.x) / (current.x - previous.x)
        const valueY = previous.y + (current.y - previous.y) * fraction
        const valueRow = Math.max(0, Math.min(rows - 1, (valueY - y) / height * (rows - 1)))
        const baselineY = previous.baselineY != null && current.baselineY != null
          ? previous.baselineY + (current.baselineY - previous.baselineY) * fraction
          : null
        const baselineRow = baselineY == null ? rows : Math.max(0, Math.min(rows - 1, (baselineY - y) / height * (rows - 1)))
        paintColumn(image, column, Math.min(valueRow, baselineRow), Math.max(valueRow, baselineRow), seed, { variant: 'gradient', intensity: 0, dim: 1, stacked: false })
        paintedThrough = column
      }
    }
    context.putImageData(image, 0, 0)
  }, [points, x, y, width, height, color])

  return <foreignObject x={x} y={y} width={width} height={height} pointerEvents="none" aria-hidden="true">
    <canvas ref={canvas} className="dither-area-fill" />
  </foreignObject>
}, (previous, next) => previous.x === next.x && previous.y === next.y
  && previous.width === next.width && previous.height === next.height && previous.color === next.color
  && previous.points.length === next.points.length && previous.points.every((point, index) => {
    const other = next.points[index]
    return point === other || (point != null && other != null
      && point.x === other.x && point.y === other.y && point.baselineY === other.baselineY)
  }))
