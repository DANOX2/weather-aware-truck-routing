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
  truckLevels: (number | null)[] | null // the truck's own risk level (0–4) at each hour
  onHour: (hour: number) => void
}

/**
 * One bar per forecast hour, drawn on the slider's scale so it lines up with the thumb:
 * height = share of the corridor at Moderate or worse, split by level (Moderate at the bottom,
 * the worst on top), so a small Severe patch is a sliver rather than a red bar. Under the bars,
 * the trip line takes the colours of the truck's own checkpoints, matching the dots and cards.
 * Hours outside the trip are dimmed.
 */
export const RiskTimeline = memo(function RiskTimeline({
  timeline,
  maxHour,
  departHour,
  arriveHour,
  truckLevels,
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
            {truckLevels?.map((level, h) => {
              const from = Math.max(h - 0.5, tripStart)
              const to = Math.min(h + 0.5, tripEnd)
              if (level === null || to <= from) return null
              return (
                <rect
                  key={h}
                  x={from}
                  y={0.97}
                  width={to - from}
                  height={0.14}
                  fill={LEVEL_COLORS[level]}
                />
              )
            })}
          </>
        )}
        {timeline.slice(0, maxHour + 1).map(({ atRisk, shares }, h) => {
          const inTrip = !hasTrip || (h >= Math.floor(tripStart) && h <= Math.ceil(tripEnd))
          const x = Math.max(h - 0.38, 0)
          const width = h === 0 || h === maxHour ? 0.38 : 0.76
          const opacity = inTrip ? 1 : 0.4
          if (atRisk === 0) {
            // A sliver for "all Low".
            return (
              <rect
                key={h}
                x={x}
                y={0.88}
                width={width}
                height={0.06}
                fill={tokens.textMuted}
                opacity={0.35 * opacity}
              />
            )
          }
          // A visible minimum for any risk, then sqrt so small shares show; every level present
          // gets at least a sliver.
          const height = Math.max(0.18, Math.sqrt(atRisk)) * 0.92
          let y = 0.94
          return (
            <g key={h} opacity={opacity}>
              {shares.map((share, i) => {
                if (share === 0) return null
                const part = Math.max((share / atRisk) * height, 0.05)
                y -= part
                return (
                  <rect
                    key={i}
                    x={x}
                    y={y}
                    width={width}
                    height={part}
                    fill={LEVEL_COLORS[i + 1]}
                  />
                )
              })}
            </g>
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
