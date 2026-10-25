import type { DitherColor } from './palette'

export type ChartType = 'pie' | 'radar'
export type ChartConfig = Record<string, { label?: string; color: DitherColor }>
export type AreaVariant = 'gradient' | 'dotted' | 'hatched' | 'solid'
export type Margins = { top: number; right: number; bottom: number; left: number }
