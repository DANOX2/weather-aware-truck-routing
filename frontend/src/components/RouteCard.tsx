import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material'

import type { RiskLevel, Route } from '../api/types.ts'
import {
  ROUTE_NAMES,
  RISK_LABEL,
  formatDuration,
  formatMiles,
  formatTime,
} from '../lib/format.ts'
import { monoFont, motion, riskColors, routeColors, tokens } from '../theme.ts'
import { RiskStrip } from './RiskStrip.tsx'

// Ranking criteria first; Moderate/Low are context, not decision drivers.
const PILLS: RiskLevel[] = ['NO_TRAVEL', 'SEVERE', 'HIGH']

interface Props {
  route: Route
  recommended: boolean
  selected: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
  why?: string
}

export function RouteCard({ route, recommended, selected, onSelect, onHover, why }: Props) {
  const color = routeColors[route.id % routeColors.length]
  const pills = PILLS.filter((lvl) => lvl !== 'NO_TRAVEL' || route.miles_by_level.NO_TRAVEL > 0)

  return (
    <ButtonBase
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-pressed={selected}
      aria-label={`Route ${ROUTE_NAMES[route.id]}${recommended ? ', recommended' : ''}`}
      sx={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        p: 2,
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: selected ? color : recommended ? tokens.borderAccent : tokens.border,
        bgcolor: selected ? 'rgba(64, 224, 208, 0.06)' : tokens.surface,
        boxShadow: selected ? `0 0 0 1px ${color}` : 'none',
        transition: `border-color ${motion.fast} ${motion.ease}, background-color ${motion.fast} ${motion.ease}, box-shadow ${motion.fast} ${motion.ease}, transform ${motion.fast} ${motion.ease}`,
        // A small lift tells you the card is the same object the map is highlighting.
        '&:hover': { borderColor: color, transform: 'translateY(-2px)' },
        '&:active': { transform: 'translateY(0)' },
        '&.Mui-focusVisible': { outline: `2px solid ${color}`, outlineOffset: 2 },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Route {ROUTE_NAMES[route.id]}
        </Typography>
        {recommended && (
          <Chip
            label="Recommended"
            size="small"
            color="primary"
            sx={{ fontWeight: 700, height: 22 }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          #{route.rank}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        {pills.map((level) => {
          const miles = route.miles_by_level[level]
          const active = miles > 0
          return (
            <Box
              key={level}
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: 1,
                border: '1px solid',
                borderColor: active ? riskColors[level] : tokens.border,
                color: active ? riskColors[level] : 'text.secondary',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.3,
              }}
            >
              {RISK_LABEL[level].toUpperCase()}{' '}
              <Box component="span" sx={{ fontFamily: monoFont }}>
                {formatMiles(miles)}
              </Box>
            </Box>
          )
        })}
      </Stack>

      <RiskStrip checkpoints={route.checkpoints} />

      <Stack
        direction="row"
        sx={{ mt: 1.5, justifyContent: 'space-between', fontFamily: monoFont, fontSize: 13 }}
      >
        <span>{formatMiles(route.distance_mi)}</span>
        <span>{formatDuration(route.duration_s)}</span>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          arrives {formatTime(route.arrival)}
        </Box>
      </Stack>

      {why && (
        <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
          {why}
        </Typography>
      )}
    </ButtonBase>
  )
}
