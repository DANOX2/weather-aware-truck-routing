import { Box, Stack, Typography } from '@mui/material'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Suspense, lazy, useState } from 'react'

import { type ApiError, fetchHeatmap, planTrip } from './api/client.ts'
import type { TripRequest } from './api/types.ts'
import { Results } from './components/Results.tsx'
import { TripForm } from './components/TripForm.tsx'
import { tokens } from './theme.ts'

// MapLibre + deck.gl are the heaviest code; load them after the form is interactive.
const TripMap = lazy(() => import('./components/TripMap.tsx'))

export default function App() {
  const [request, setRequest] = useState<TripRequest | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState(true)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const trip = useQuery({
    queryKey: ['trip', request],
    queryFn: () => planTrip(request!),
    enabled: request !== null,
    placeholderData: keepPreviousData, // keep the last result on screen while re-planning
    retry: false,
  })
  const error = trip.error as ApiError | null

  // Same corridor for every checkpoint interval, so the interval isn't part of the key.
  const routes = trip.data?.routes
  const heatmap = useQuery({
    queryKey: ['heatmap', request?.origin, request?.destination, request?.depart_at, request?.weight_lb, routes?.length],
    queryFn: () => fetchHeatmap(routes!.map((r) => r.path), request!.weight_lb),
    enabled: Boolean(routes && request),
    retry: false,
  })

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '420px 1fr' },
        gridTemplateRows: { xs: '62vh auto', md: '100vh' },
        height: { md: '100vh' },
      }}
    >
      <Box
        component="aside"
        sx={{
          order: { xs: 2, md: 1 },
          overflowY: 'auto',
          borderRight: { md: `1px solid ${tokens.border}` },
          bgcolor: 'background.default',
        }}
      >
        <Stack spacing={3} sx={{ p: 3 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Weather-aware{' '}
              <Box component="span" sx={{ color: 'primary.main' }}>
                truck routing
              </Box>
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              The safest route for your load, using the forecast for when you'll actually be
              there.
            </Typography>
          </Box>

          <TripForm
            onSubmit={(next) => {
              setRequest(next)
              setSelectedId(null)
              setEditing(false)
            }}
            collapsed={!editing && !error}
            onEdit={() => setEditing(true)}
            busy={trip.isFetching}
            serverErrors={error?.code === 'validation' ? error.fields : undefined}
          />

          <Results
            trip={trip.data}
            loading={trip.isFetching}
            error={error}
            onRetry={() => trip.refetch()}
            selectedId={selectedId ?? trip.data?.recommendation.route_id ?? null}
            onSelect={setSelectedId}
            onHover={setHoveredId}
          />
        </Stack>
      </Box>

      <Box
        component="main"
        aria-label="Map of route options"
        sx={{
          order: { xs: 1, md: 2 },
          position: 'relative',
          bgcolor: tokens.navyDeep,
          minHeight: { xs: '62vh' },
        }}
      >
        <Suspense fallback={null}>
          <TripMap
            trip={trip.data}
            heatmap={heatmap.data}
            heatmapLoading={heatmap.isFetching}
            heatmapError={heatmap.isError}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onHover={setHoveredId}
          />
        </Suspense>
      </Box>
    </Box>
  )
}
