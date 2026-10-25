"use client"

import { useEffect, useRef } from "react"
import { BAYER, backingSize, bloomLayerStyle, easeInOutCubic, OFF_TIER, paintPixel, prefersReducedMotion } from "./dither-paint"
import { sliceAtAngle } from "./polar"
import { usePolarChart } from "./polar-context"

const TOP = -Math.PI / 2
const TAU = Math.PI * 2
const POP = 6

/** Paint on slice changes; the entrance sweep composites the cached texture. */
export function PieCanvas() {
  const ctx = usePolarChart()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)
  const progress = useRef(1)
  const draw = useRef<() => void>(() => {})
  const { width, height } = ctx.plot
  const { cols, rows } = backingSize(width, height)
  const { ready, pie, seedOf, variantOf, hoverIndex, selectedDataKey, focusDataKey,
    innerRadius, outerRadius, isMouseInChart, bloom, bloomOnHover } = ctx
  const centerX = ctx.center.x
  const centerY = ctx.center.y
  const emphasis = selectedDataKey ?? focusDataKey

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context || !ready || !pie) return
    if (canvas.width !== cols) canvas.width = cols
    if (canvas.height !== rows) canvas.height = rows

    const texture = document.createElement("canvas")
    texture.width = cols
    texture.height = rows
    const textureContext = texture.getContext("2d")
    if (!textureContext) return
    const image = textureContext.createImageData(cols, rows)
    const styles = pie.map(slice => ({
      color: seedOf(slice.name).fill,
      variant: variantOf(slice.name),
      dim: emphasis !== null && emphasis !== slice.name ? 0.3 : 1,
    }))
    for (let y = 0; y < rows; y++) {
      const dy = (y + 0.5) * height / rows - centerY
      for (let x = 0; x < cols; x++) {
        const dx = (x + 0.5) * width / cols - centerX
        const radius = Math.hypot(dx, dy)
        if (radius < innerRadius || radius > outerRadius + POP) continue
        const index = sliceAtAngle(pie, Math.atan2(dy, dx))
        if (index < 0) continue
        const active = index === hoverIndex
        const edge = outerRadius + (active ? POP : 0)
        if (radius > edge) continue
        const { color, variant, dim } = styles[index]
        if (edge - radius < (active ? 2.4 : 1.4)) {
          paintPixel(image, x, y, color, dim)
          continue
        }
        const density = (radius - innerRadius) / Math.max(edge - innerRadius, 1)
        const intensity = (isMouseInChart ? 1 : 0) + (active ? 0.4 : 0)
        if (variant === "hatched" && ((x + y) & 3) >= 2) continue
        const lit = variant === "solid" || density > BAYER[y & 3][x & 3] - 0.1 * intensity - (variant === "dotted" ? 0.12 : 0)
        if (variant === "dotted" && !lit) continue
        const alpha = (0.35 + density * 0.65) * (1 + 0.22 * intensity) * (lit ? 1 : OFF_TIER) * dim
        paintPixel(image, x, y, color, Math.min(1, alpha))
      }
    }
    textureContext.putImageData(image, 0, 0)

    const bloomCanvas = bloomRef.current
    const bloomContext = bloomCanvas?.getContext("2d")
    if (bloomCanvas) {
      bloomCanvas.width = cols
      bloomCanvas.height = rows
    }
    const composite = () => {
      context.clearRect(0, 0, cols, rows)
      context.save()
      if (progress.current < 1) {
        context.beginPath()
        context.moveTo(cols / 2, rows / 2)
        context.arc(cols / 2, rows / 2, Math.hypot(cols, rows), TOP, TOP + easeInOutCubic(progress.current) * TAU)
        context.closePath()
        context.clip()
      }
      context.drawImage(texture, 0, 0)
      context.restore()
      if (bloomContext) {
        bloomContext.clearRect(0, 0, cols, rows)
        if (bloom !== "off" && (!bloomOnHover || isMouseInChart)) bloomContext.drawImage(canvas, 0, 0)
      }
    }
    draw.current = composite
    composite()
    return () => { draw.current = () => {} }
  }, [ready, pie, seedOf, variantOf, hoverIndex, emphasis, innerRadius, outerRadius,
    isMouseInChart, bloom, bloomOnHover, width, height, cols, rows, centerX, centerY])

  const { animate, animationDuration, revision } = ctx
  useEffect(() => {
    if (!ready) return
    if (!animate || prefersReducedMotion() || animationDuration <= 0) {
      progress.current = 1
      draw.current()
      return
    }
    let raf = 0
    const start = performance.now()
    const frame = (now: number) => {
      progress.current = Math.min(1, (now - start) / animationDuration)
      draw.current()
      if (progress.current < 1) raf = requestAnimationFrame(frame)
    }
    progress.current = 0
    draw.current()
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [ready, animate, animationDuration, revision, cols, rows])

  const bloomStyle = bloomLayerStyle(bloom, bloomOnHover ? isMouseInChart : true)
  const position = { left: ctx.margins.left, top: ctx.margins.top, width, height }
  return <>
    <canvas ref={canvasRef} className="dk-canvas" style={{ ...position, imageRendering: "pixelated" }} />
    <canvas ref={bloomRef} className="dk-canvas" style={{ ...position, ...(bloomStyle ?? { opacity: 0 }) }} />
  </>
}
