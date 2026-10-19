import { Box } from '@mui/material'
import { memo } from 'react'

import type { HourSummary } from '../lib/heatmap.ts'
import { riskColors, tokens } from '../theme.ts'

const LEVEL_COLORS = [
  riskColors.LOW,
  riskColors.MODERATE,
  riskColors.HIGH,
  riskColors.SEVERE,
  riskColors.NO_TRAVEL,
]

interface Props {
  timeline: HourSummary[]
  maxHour: number
  departHour: number | null
  arriveHour: number | null
  onHour: (hour: number) => void
}

/**
 * One bar per forecast hour, drawn on the slider's scale so it lines up with the thumb:
 * height = share of the corridor at Moderate or worse, colour = the worst level anywhere.
 * The trip window is highlighted and hours outside it are dimmed.
 */
export const RiskTimeline = memo(function RiskTimeline({
  timeline,
  maxHour,
  departHour,
  arriveHour,
  onHour,
}: Props) {
  const tripStart = departHour ?? 0
  const tripEnd = Math.min(arriveHour ?? maxHour, maxHour)
  const hasTrip = departHour !== null && arriveHour !== null && tripEnd > tripStart

  return (
    <Box
      sx={{ position: 'relative', height: { xs: 24, md: 34 }, cursor: 'pointer' }}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        onHour(Math.round(((e.clientX - box.left) / box.width) * maxHour))
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${maxHour} 1`}
        preserveAspectRatio="none"
        aria-hidden
        style={{ display: 'block', overflow: 'visible' }}
      >
        {hasTrip && (
          <>
            <rect
              x={tripStart}
              width={tripEnd - tripStart}
              height={1}
              fill={tokens.turquoise}
              opacity={0.1}
            />
            <rect
              x={tripStart}
              y={0.97}
              width={tripEnd - tripStart}
              height={0.06}
              fill={tokens.turquoise}
            />
          </>
        )}
        {timeline.slice(0, maxHour + 1).map(({ atRisk, worst }, h) => {
          const inTrip = !hasTrip || (h >= Math.floor(tripStart) && h <= Math.ceil(tripEnd))
          // A sliver for "all Low", a visible minimum for any risk, then sqrt so small shares show.
          const height = worst < 1 ? 0.06 : Math.max(0.18, Math.sqrt(atRisk)) * 0.92
          return (
            <rect
              key={h}
              x={Math.max(h - 0.38, 0)}
              y={0.94 - height}
              width={h === 0 || h === maxHour ? 0.38 : 0.76}
              height={height}
              fill={worst < 1 ? tokens.textMuted : LEVEL_COLORS[Math.min(Math.floor(worst), 4)]}
              opacity={(worst < 1 ? 0.35 : 1) * (inTrip ? 1 : 0.4)}
            />
          )
        })}
      </svg>
      {hasTrip && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: -1,
            left: `${(tripStart / maxHour) * 100}%`,
            ml: '3px',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.6,
            color: tokens.turquoise,
            pointerEvents: 'none',
          }}
        >
          TRIP
        </Box>
      )}
    </Box>
  )
})
