import type { PickingInfo } from '@deck.gl/core'
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from '@deck.gl/extensions'
import { BitmapLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { Box, Paper, Stack, Typography, useMediaQuery } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibre,
  NavigationControl,
  type RasterTileSource,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 locates its worker next to its own module, which bundlers move; ship it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'

import { RISK_LEVELS, type Checkpoint, type Heatmap, type Route, type Trip } from '../api/types.ts'
import { describeCause } from '../lib/explain.ts'
import { buildFrames, truckStatus } from '../lib/heatmap.ts'
import { RISK_LABEL, ROUTE_NAMES, formatDuration, formatMiles, formatTime } from '../lib/format.ts'
import {
  RADAR_ATTRIBUTION,
  RADAR_REFRESH_MS,
  latestRadarTime,
  radarTileUrl,
} from '../lib/radar.ts'
import { riskColors, routeColors, tokens } from '../theme.ts'
import { HeatmapControls, type MapLayer, type TruckStatusLine } from './HeatmapControls.tsx'

setWorkerUrl(workerUrl)

const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const US_CENTER: [number, number] = [-98.5, 39.5]
const DATA_CREDITS = [
  'Routing © <a href="https://www.tomtom.com/" target="_blank">TomTom</a>',
  'Weather data by <a href="https://open-meteo.com/" target="_blank">Open-Meteo.com</a>',
]
const labelCollision = new CollisionFilterExtension() // hides a label that would overlap another
// Checkpoints the truck passes this close to the slider's time get a ring.
const NOW_WINDOW_S = 45 * 60

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
  const [styleReady, setStyleReady] = useState(false)
  // Small screens get name-only labels; the route cards sit right below the map there.
  const compactLabels = useMediaQuery((theme) => theme.breakpoints.down('md'))

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
    // Top-left keeps the credit clear of the heatmap panel on every screen size.
    instance.addControl(
      new AttributionControl({ compact: true, customAttribution: DATA_CREDITS }),
      'top-left',
    )
    instance.once('load', () => setStyleReady(true))
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
    // Leave room for the heatmap panel along the bottom edge.
    const compact = map.current.getContainer().clientWidth < 600
    map.current.fitBounds(bounds, {
      padding: { top: 48, left: 48, right: 64, bottom: compact ? 130 : 190 },
      duration: 900,
      maxZoom: 9,
    })
  }, [trip])

  const focusId = hoveredId ?? selectedId ?? trip?.recommendation.route_id ?? null
  const focusRoute = trip?.routes.find((r) => r.id === focusId)

  // Heatmap: frames are painted once per payload; the slider only picks which to show.
  const frames = useMemo(() => (heatmap ? buildFrames(heatmap) : null), [heatmap])
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [layer, setLayer] = useState<MapLayer>('forecast')
  const heatVisible = layer === 'forecast'
  const start = frames?.start ?? null
  const departHour =
    start !== null && focusRoute ? clampHour(hoursBetween(start, focusRoute.departure)) : null
  const arriveHour =
    start !== null && focusRoute ? hoursBetween(start, focusRoute.arrival) : null

  // The focused truck's own risk per forecast hour, for the timeline's trip line: the worst
  // checkpoint it reaches in that hour, or the nearest one when none falls inside it.
  const truckLevels = useMemo(() => {
    if (!frames || !focusRoute) return null
    const levels = frames.timeline.map((_, h) => {
      const truck = truckStatus(focusRoute, frames.start + h * 3600)
      return truck.phase === 'en-route' && truck.checkpoint.level
        ? RISK_LEVELS.indexOf(truck.checkpoint.level)
        : null
    })
    const reached = new Set<number>()
    for (const cp of focusRoute.checkpoints) {
      const h = Math.round((Date.parse(cp.eta) / 1000 - frames.start) / 3600)
      if (h < 0 || h >= levels.length || !cp.level) continue
      const level = RISK_LEVELS.indexOf(cp.level)
      levels[h] = reached.has(h) ? Math.max(levels[h] ?? 0, level) : level
      reached.add(h)
    }
    return levels
  }, [frames, focusRoute])

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
      new TextLayer<Route, CollisionFilterExtensionProps<Route>>({
        id: 'route-labels',
        data: routes,
        getPosition: labelPosition,
        getText: (r) =>
          compactLabels
            ? `Route ${ROUTE_NAMES[r.id]}`
            : routeLabel(r, r.id === trip.recommendation.route_id),
        getSize: 12,
        lineHeight: 1.35,
        fontFamily: '"DM Sans", system-ui, sans-serif',
        fontWeight: 600,
        characterSet: 'auto',
        getColor: [255, 255, 255, 255],
        background: true,
        getBackgroundColor: (r) => rgba(tokens.navyDeep, isFocus(r) ? 240 : 200),
        getBorderColor: (r) => rgba(routeColors[r.id % routeColors.length]),
        getBorderWidth: (r) => (isFocus(r) ? 2 : 1),
        backgroundPadding: [7, 4],
        pickable: true,
        onClick: ({ object }) => object && onSelect(object.id),
        onHover: ({ object }) => onHover(object?.id ?? null),
        extensions: [labelCollision],
        collisionEnabled: true,
        // The focused route's label wins a collision, then the recommended one.
        getCollisionPriority: (r) =>
          isFocus(r) ? 2 : r.id === trip.recommendation.route_id ? 1 : 0,
        collisionTestProps: { sizeScale: 1.3 },
        updateTriggers: {
          getBackgroundColor: focusId,
          getBorderWidth: focusId,
          getCollisionPriority: focusId,
          getText: compactLabels,
        },
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
  }, [trip, focusId, onSelect, onHover, compactLabels])

  const truck = frames && focusRoute ? truckStatus(focusRoute, frames.start + hour * 3600) : null
  const statusLine = trip && focusRoute && truck ? describeTruck(trip, focusRoute, truck) : null
  // The truck belongs to the forecast's clock, so the live radar hides it.
  const truckAt = truck?.phase === 'en-route' && layer !== 'radar' ? truck.position : null
  // The checkpoints to compare with the shading: the ones the truck passes around this hour.
  const nowCheckpoints = useMemo(() => {
    if (!frames || !focusRoute || !heatVisible) return []
    const at = frames.start + hour * 3600
    return focusRoute.checkpoints.filter(
      (cp) => cp.level && Math.abs(Date.parse(cp.eta) / 1000 - at) <= NOW_WINDOW_S,
    )
  }, [frames, focusRoute, heatVisible, hour])

  // Live radar: the latest scan time, refreshed every 2 minutes while the radar is on.
  const radarScan = useQuery({
    queryKey: ['radar-scan'],
    queryFn: ({ signal }) => latestRadarTime(signal),
    enabled: layer === 'radar',
    refetchInterval: RADAR_REFRESH_MS,
    staleTime: RADAR_REFRESH_MS / 2,
  })
  const scan = layer === 'radar' ? (radarScan.data ?? null) : null

  // A MapLibre raster layer (under the basemap's labels), so tiles stream and cache natively.
  useEffect(() => {
    const instance = map.current
    if (!instance || !styleReady) return
    const source = instance.getSource<RasterTileSource>('radar')
    if (!scan) {
      if (source) {
        instance.removeLayer('radar')
        instance.removeSource('radar')
      }
      return
    }
    if (source) {
      source.setTiles([radarTileUrl(scan)])
      return
    }
    instance.addSource('radar', {
      type: 'raster',
      tiles: [radarTileUrl(scan)],
      tileSize: 256,
      maxzoom: 10,
      attribution: RADAR_ATTRIBUTION,
    })
    const firstLabel = instance.getStyle().layers.find((l) => l.type === 'symbol')?.id
    instance.addLayer(
      { id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.8 } },
      firstLabel,
    )
  }, [scan, styleReady])

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
    overlay.current?.setProps({
      layers: [
        ...frameLayers,
        ...routeLayers,
        new ScatterplotLayer<Checkpoint>({
          id: 'checkpoints-now',
          data: nowCheckpoints,
          getPosition: (cp) => [cp.lon, cp.lat],
          getRadius: 10,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          getLineColor: [255, 255, 255, 220],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
        }),
        new ScatterplotLayer<[number, number]>({
          id: 'truck',
          data: truckAt ? [truckAt] : [],
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
  }, [routeLayers, frames, heatVisible, hour, focusRoute, truckAt, nowCheckpoints])

  return (
    <Box sx={{ position: 'absolute', inset: 0 }} onMouseLeave={() => setTooltip(null)}>
      {/* MapLibre's CSS forces position: relative on this node, so size it explicitly. */}
      <Box ref={container} sx={{ width: '100%', height: '100%' }} />

      {trip && (
        <HeatmapControls
          start={start}
          timeline={frames?.timeline ?? null}
          status={statusLine}
          hour={hour}
          onHour={setHour}
          playing={playing}
          onPlaying={setPlaying}
          layer={layer}
          onLayer={setLayer}
          radar={{ scan, error: radarScan.isError }}
          departHour={departHour}
          arriveHour={arriveHour}
          truckLevels={truckLevels}
          loading={heatmapLoading}
          error={heatmapError}
        />
      )}

      {tooltip && trip && <CheckpointTooltip {...tooltip} trip={trip} />}
    </Box>
  )
}

const TOOLTIP_WIDTH = 260

/** Route summary pinned on the map, staggered along each route so labels rarely collide. */
function routeLabel(route: Route, recommended: boolean): string {
  const miles = route.miles_by_level
  const worst = miles.NO_TRAVEL
    ? `${formatMiles(miles.NO_TRAVEL)} No travel`
    : miles.SEVERE
      ? `${formatMiles(miles.SEVERE)} Severe`
      : miles.HIGH
        ? `${formatMiles(miles.HIGH)} High`
        : 'No Severe or High'
  const name = `Route ${ROUTE_NAMES[route.id]}${recommended ? ' · Recommended' : ''}`
  return `${name}\n${formatDuration(route.duration_s)} · ${worst}`
}

function labelPosition(route: Route): [number, number] {
  const share = [0.5, 0.35, 0.65][route.id % 3]
  return route.path[Math.round((route.path.length - 1) * share)]
}

/** The heatmap's status line: where the focused route's truck is at the slider's hour, and why. */
function describeTruck(
  trip: Trip,
  route: Route,
  truck: ReturnType<typeof truckStatus>,
): TruckStatusLine {
  const name = `Route ${ROUTE_NAMES[route.id]}`
  if (truck.phase !== 'en-route') {
    const text =
      truck.phase === 'before'
        ? `Before departure · ${name} leaves ${formatTime(route.departure)}`
        : `${name} arrived ${formatTime(route.arrival)} · corridor forecast only`
    return { text, color: null }
  }
  const cp = truck.checkpoint
  const cause = describeCause(cp, trip.weight_lb, trip.wind_metric)
  const level = cp.level ? `${RISK_LABEL[cp.level]}: ${cause}` : cause
  return {
    text: `${name} · mile ${Math.round(truck.mile)} · ${level}`,
    color: cp.level ? riskColors[cp.level] : null,
  }
}

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
