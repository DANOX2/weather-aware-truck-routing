import type { PickingInfo } from '@deck.gl/core'
import { BitmapLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { Box, Paper, Stack, Typography } from '@mui/material'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 locates its worker next to its own module, which bundlers move; ship it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Checkpoint, Heatmap, Route, Trip } from '../api/types.ts'
import { describeCause } from '../lib/explain.ts'
import { buildFrames, truckPosition } from '../lib/heatmap.ts'
import { RISK_LABEL, ROUTE_NAMES, formatTime } from '../lib/format.ts'
import { riskColors, routeColors, tokens } from '../theme.ts'
import { HeatmapControls } from './HeatmapControls.tsx'

setWorkerUrl(workerUrl)

const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const US_CENTER: [number, number] = [-98.5, 39.5]

type RGBA = [number, number, number, number]
const rgba = (hex: string, alpha = 255): RGBA => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  alpha,
]

interface CheckpointDatum {
  route: Route
  cp: Checkpoint
}

interface Props {
  trip?: Trip
  heatmap?: Heatmap
  heatmapLoading: boolean
  heatmapError: boolean
  selectedId: number | null
  hoveredId: number | null
  onSelect: (id: number) => void
  onHover: (id: number | null) => void
}

const hoursBetween = (from: number, iso: string) => (Date.parse(iso) / 1000 - from) / 3600

export default function TripMap({
  trip,
  heatmap,
  heatmapLoading,
  heatmapError,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const overlay = useRef<MapboxOverlay | null>(null)
  const [tooltip, setTooltip] = useState<Omit<TooltipProps, 'trip'> | null>(null)

  // Create the map once.
  useEffect(() => {
    const instance = new MapLibre({
      container: container.current!,
      style: BASEMAP,
      center: US_CENTER,
      zoom: 3.4,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    instance.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    // Overlaid (own canvas): deck.gl 9.4's interleaved mode does not render with MapLibre 6.
    const deck = new MapboxOverlay({ interleaved: false, layers: [] })
    instance.addControl(deck)
    map.current = instance
    overlay.current = deck
    // MapLibre only tracks window resizes; the panel can also change (mobile, sidebar).
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current!)
    return () => {
      observer.disconnect()
      instance.remove()
      map.current = null
      overlay.current = null
    }
  }, [])

  // Fit every route on screen whenever a new trip arrives.
  useEffect(() => {
    if (!trip || !map.current) return
    const bounds = new LngLatBounds()
    trip.routes.forEach((r) => r.path.forEach((p) => bounds.extend(p)))
    map.current.fitBounds(bounds, { padding: 64, duration: 900, maxZoom: 9 })
  }, [trip])

  const focusId = hoveredId ?? selectedId ?? trip?.recommendation.route_id ?? null
  const focusRoute = trip?.routes.find((r) => r.id === focusId)

  // Heatmap: frames are painted once per payload; the slider only picks which to show.
  const frames = useMemo(() => (heatmap ? buildFrames(heatmap) : null), [heatmap])
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [heatVisible, setHeatVisible] = useState(true)
  const start = frames?.start ?? null
  const departHour =
    start !== null && focusRoute ? clampHour(hoursBetween(start, focusRoute.departure)) : null
  const arriveHour =
    start !== null && focusRoute ? hoursBetween(start, focusRoute.arrival) : null

  // New heatmap → jump the slider to the departure hour (React's "adjust state on prop change").
  const [shownFrames, setShownFrames] = useState(frames)
  if (frames !== shownFrames) {
    setShownFrames(frames)
    setPlaying(false)
    if (departHour !== null) setHour(departHour)
  }

  // Route and checkpoint layers change with the trip or focus, never with the slider.
  const routeLayers = useMemo(() => {
    if (!trip) return []
    // Focused route last, so it draws on top.
    const routes = [...trip.routes].sort((a, b) => Number(a.id === focusId) - Number(b.id === focusId))
    const checkpoints: CheckpointDatum[] = routes.flatMap((route) =>
      route.checkpoints.map((cp) => ({ route, cp })),
    )
    const isFocus = (route: Route) => route.id === focusId

    return [
      new PathLayer<Route>({
        id: 'route-casing',
        data: routes,
        getPath: (r) => r.path,
        getColor: rgba(tokens.navyDeep),
        getWidth: (r) => (isFocus(r) ? 11 : 7),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getWidth: focusId },
      }),
      new PathLayer<Route>({
        id: 'routes',
        data: routes,
        getPath: (r) => r.path,
        getColor: (r) => rgba(routeColors[r.id % routeColors.length], isFocus(r) ? 255 : 150),
        getWidth: (r) => (isFocus(r) ? 6 : 3.5),
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        onClick: ({ object }) => object && onSelect(object.id),
        onHover: ({ object }) => onHover(object?.id ?? null),
        updateTriggers: { getColor: focusId, getWidth: focusId },
        transitions: { getWidth: 150 },
      }),
      new ScatterplotLayer<CheckpointDatum>({
        id: 'checkpoints',
        data: checkpoints,
        getPosition: (d) => [d.cp.lon, d.cp.lat],
        getRadius: (d) => (isFocus(d.route) ? 6 : 3.5),
        radiusUnits: 'pixels',
        getFillColor: (d) =>
          d.cp.level ? rgba(riskColors[d.cp.level], isFocus(d.route) ? 255 : 170) : [120, 130, 140, 160],
        stroked: true,
        getLineColor: (d) => (isFocus(d.route) ? rgba(tokens.navyDeep) : [0, 0, 0, 0]),
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        pickable: true,
        onHover: (info: PickingInfo<CheckpointDatum>) =>
          setTooltip(
            info.object
              ? {
                  x: info.x,
                  y: info.y,
                  datum: info.object,
                  flip: info.x > (info.viewport?.width ?? Infinity) - TOOLTIP_WIDTH - 32,
                }
              : null,
          ),
        updateTriggers: { getRadius: focusId, getFillColor: focusId, getLineColor: focusId },
      }),
      new ScatterplotLayer<{ position: [number, number]; color: RGBA }>({
        id: 'endpoints',
        data: [
          { position: trip.routes[0].path[0], color: [255, 255, 255, 255] },
          { position: trip.routes[0].path.at(-1)!, color: rgba(tokens.turquoise) },
        ],
        getPosition: (d) => d.position,
        getFillColor: (d) => d.color,
        getRadius: 8,
        radiusUnits: 'pixels',
        stroked: true,
        getLineColor: rgba(tokens.navyDeep),
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
      }),
    ]
  }, [trip, focusId, onSelect, onHover])

  // Per-frame layers: two forecast hours cross-faded, plus the truck at that moment.
  useEffect(() => {
    // One layer per forecast hour keeps each image on the GPU after its first upload;
    // scrubbing only toggles visibility and opacity, so frames stay cheap.
    const lower = Math.floor(hour)
    const upper = frames ? Math.min(lower + 1, frames.frames.length - 1) : lower
    const frameLayers = (frames?.frames ?? []).map(
      (image, i) =>
        new BitmapLayer({
          id: `heat-${i}`,
          image,
          bounds: frames!.bounds,
          visible: heatVisible && (i === lower || i === upper),
          opacity: i === upper && upper !== lower ? hour - lower : 1,
        }),
    )
    const truck =
      frames && focusRoute ? truckPosition(focusRoute, frames.start + hour * 3600) : null
    overlay.current?.setProps({
      layers: [
        ...frameLayers,
        ...routeLayers,
        new ScatterplotLayer<[number, number]>({
          id: 'truck',
          data: truck ? [truck] : [],
          getPosition: (d) => d,
          getFillColor: [255, 255, 255, 255],
          getRadius: 7,
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: rgba(routeColors[(focusRoute?.id ?? 0) % routeColors.length]),
          getLineWidth: 4,
          lineWidthUnits: 'pixels',
          updateTriggers: { getPosition: hour, getLineColor: focusRoute?.id },
        }),
      ],
    })
  }, [routeLayers, frames, heatVisible, hour, focusRoute])

  return (
    <Box sx={{ position: 'absolute', inset: 0 }} onMouseLeave={() => setTooltip(null)}>
      {/* MapLibre's CSS forces position: relative on this node, so size it explicitly. */}
      <Box ref={container} sx={{ width: '100%', height: '100%' }} />

      {trip && (
        <HeatmapControls
          start={start}
          hour={hour}
          onHour={setHour}
          playing={playing}
          onPlaying={setPlaying}
          visible={heatVisible}
          onVisible={setHeatVisible}
          departHour={departHour}
          arriveHour={arriveHour}
          loading={heatmapLoading}
          error={heatmapError}
        />
      )}

      {tooltip && trip && <CheckpointTooltip {...tooltip} trip={trip} />}
    </Box>
  )
}

const TOOLTIP_WIDTH = 260

function clampHour(hour: number) {
  return Math.min(Math.max(hour, 0), 48)
}

interface TooltipProps {
  x: number
  y: number
  datum: CheckpointDatum
  trip: Trip
  flip: boolean // open to the left of the pointer near the right edge
}

function CheckpointTooltip({ x, y, datum, trip, flip }: TooltipProps) {
  const { route, cp } = datum
  return (
    <Paper
      elevation={6}
      sx={{
        position: 'absolute',
        left: flip ? x - TOOLTIP_WIDTH - 14 : x + 14,
        top: y + 14,
        p: 1.5,
        width: TOOLTIP_WIDTH,
        pointerEvents: 'none',
        bgcolor: tokens.surfaceRaised,
        zIndex: 2,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: cp.level ? riskColors[cp.level] : tokens.border,
          }}
        />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {cp.level ? RISK_LABEL[cp.level] : 'Not scored'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Route {ROUTE_NAMES[route.id]} · mile {Math.round(cp.mile)}
        </Typography>
      </Stack>
      <Typography variant="body2">{describeCause(cp, trip.weight_lb, trip.wind_metric)}</Typography>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Truck arrives {formatTime(cp.eta)}
        {cp.forecast_time && ` · forecast for ${formatTime(cp.forecast_time)}`}
      </Typography>
    </Paper>
  )
}
