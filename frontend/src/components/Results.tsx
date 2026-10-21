import RefreshIcon from '@mui/icons-material/Refresh'
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'

import type { ApiError } from '../api/client.ts'
import type { Trip } from '../api/types.ts'
import { explainRecommendation } from '../lib/explain.ts'
import { ROUTE_NAMES } from '../lib/format.ts'
import { rise } from '../theme.ts'
import { RiskLegend } from './RiskLegend.tsx'
import { RouteCard } from './RouteCard.tsx'

interface Props {
  trip?: Trip
  loading: boolean
  error: ApiError | null
  onRetry: () => void
  selectedId: number | null
  onSelect: (id: number) => void
  onHover: (id: number | null) => void
}

function LoadingState() {
  return (
    <Stack spacing={1.5} aria-busy="true" aria-live="polite">
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Finding truck routes and checking the forecast at every checkpoint — usually about 4
        seconds.
      </Typography>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={148} sx={{ borderRadius: 2.5 }} />
      ))}
    </Stack>
  )
}

function EmptyState() {
  return (
    <Stack spacing={1.5} sx={{ color: 'text.secondary' }}>
      <Typography variant="body2">
        Compare up to three truck routes. Each one is scored on the weather forecast for the
        moment your truck reaches each checkpoint, and on your load weight.
      </Typography>
      <RiskLegend />
    </Stack>
  )
}

export function Results({ trip, loading, error, onRetry, selectedId, onSelect, onHover }: Props) {
  if (error && error.code !== 'validation') {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={onRetry}>
            Retry
          </Button>
        }
      >
        {error.message}
      </Alert>
    )
  }
  if (!trip) return loading ? <LoadingState /> : <EmptyState />

  const ranked = [...trip.routes].sort((a, b) => a.rank - b.rank)
  const best = trip.recommendation.route_id
  const reasons = explainRecommendation(trip)

  return (
    <Stack spacing={2} sx={{ position: 'relative' }}>
      {loading && (
        <LinearProgress sx={{ position: 'absolute', top: -12, left: 0, right: 0, height: 2 }} />
      )}

      {trip.recommendation.all_have_no_travel && (
        <Alert severity="warning">
          Every route crosses <b>No-travel</b> weather at this departure time. Try leaving
          later, or check the heatmap for when conditions clear.
        </Alert>
      )}

      <Box aria-live="polite" sx={rise()}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="overline" sx={{ color: 'primary.main', lineHeight: 1.5 }}>
            Recommendation
          </Typography>
          {trip.demo && <Chip label="Demo data" size="small" variant="outlined" />}
        </Stack>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Take Route {ROUTE_NAMES[best]}
        </Typography>
        {reasons.length > 0 && (
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, color: 'text.secondary' }}>
            {reasons.map((reason) => (
              <Typography component="li" variant="body2" key={reason}>
                {reason}
              </Typography>
            ))}
          </Box>
        )}
        {trip.routing_provider === 'valhalla' && (
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            Our main routing service is unavailable, so these routes come from the OpenStreetMap
            backup. Drive times don't include live traffic.
          </Typography>
        )}
        {trip.routes.length < 3 && (
          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            Only {trip.routes.length} truck route{trip.routes.length > 1 ? 's' : ''} for this
            trip {trip.routes.length > 1 ? 'are' : 'is'} within twice the fastest time without
            repeating another.
          </Typography>
        )}
      </Box>

      <Stack spacing={1.5}>
        {ranked.map((route, i) => (
          // Staggered so the ranking reads top-down, the order the cards are already in.
          <Box key={route.id} sx={rise(80 + i * 70)}>
            <RouteCard
              route={route}
              recommended={route.id === best}
              selected={route.id === selectedId}
              onSelect={() => onSelect(route.id)}
              onHover={(hovering) => onHover(hovering ? route.id : null)}
            />
          </Box>
        ))}
      </Stack>

      <RiskLegend dense />
    </Stack>
  )
}
