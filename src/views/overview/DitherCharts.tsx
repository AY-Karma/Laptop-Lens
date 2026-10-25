import { useEffect, useMemo } from 'react'
import type { ChartConfig } from '../../components/dither-kit/chart-types'
import { rgb, seedOfColor, type DitherColor } from '../../components/dither-kit/palette'
import { Pie } from '../../components/dither-kit/pie'
import { PieChart } from '../../components/dither-kit/pie-chart'
import { usePolarChart } from '../../components/dither-kit/polar-context'
import './ditherCharts.css'

export const ALLOCATION_COLORS: DitherColor[] = ['blue', 'green', 'orange', 'pink', 'purple', 'red', 'green', 'grey']
export const allocationColor = (index: number) => rgb(seedOfColor(ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]).fill)

interface DonutSlice { symbol: string; value: number }

function DonutFocus({ active }: { active: number | null }) {
  const { setFocusDataKey } = usePolarChart()
  useEffect(() => setFocusDataKey(active == null ? null : `slice-${active}`), [active, setFocusDataKey])
  return null
}
DonutFocus.chartLayer = 'dom' as const

export function DitherDonut({ slices, active, onActiveChange, hidden }: {
  slices: DonutSlice[]
  active: number | null
  onActiveChange: (index: number | null) => void
  hidden: boolean
}) {
  const data = useMemo(() => slices.map((slice, index) => ({ name: `slice-${index}`, value: slice.value })), [slices])
  const config = useMemo<ChartConfig>(() => Object.fromEntries(slices.map((slice, index) => [
    `slice-${index}`, { label: hidden ? 'Hidden holding' : slice.symbol, color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] },
  ])), [slices, hidden])
  return (
    <div className="overview-dither-donut" role="img" aria-label={hidden ? 'Allocation hidden' : 'Memory allocation. Focus a legend item for details.'}>
      <PieChart data={data} config={config} dataKey="value" nameKey="name" innerRadius={0.64}
        margins={{ top: 10, bottom: 10, left: 10, right: 10 }} bloom="off" animate={false} onHoverChange={onActiveChange}>
        <Pie variant="gradient" />
        <DonutFocus active={active} />
      </PieChart>
    </div>
  )
}
