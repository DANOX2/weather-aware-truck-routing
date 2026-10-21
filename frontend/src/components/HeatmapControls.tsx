import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { HourSummary } from '../lib/heatmap.ts'
import { formatTime } from '../lib/format.ts'
import { DBZ_RAMP } from '../lib/radar.ts'
import { monoFont, rise, tokens } from '../theme.ts'
import { RiskLegend } from './RiskLegend.tsx'
import { RiskTimeline } from './RiskTimeline.tsx'

const STEP = 0.25 // quarter-hour steps; the map cross-fades between forecast hours
const HOURS_PER_SECOND = 2 // at 1× playback
const SPEEDS = [0.5, 1, 1.5, 2]
// Radar scans land ~2 min apart; this is the pace they replay at, not the pace they arrive.
const SCANS_PER_SECOND = 2.5
// A beat on the newest scan before the loop restarts, so the end of the sweep reads as the end.
const RADAR_HOLD = 1.2

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
// Scan times are minutes old, so the weekday `formatTime` carries would only be noise.
const scanFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** Slider ticks on local clock hours (every 6–24 h by width and range); midnight shows the day. */
function clockTicks(start: number, stepHours: number, maxHour: number) {
  const ticks = []
  const first = new Date(start * 1000)
  first.setMinutes(0, 0, 0)
  for (let d = first; ; d = new Date(d.getTime() + 3600_000)) {
    const value = (d.getTime() / 1000 - start) / 3600
    if (value > maxHour - 1.5) break
    if (value < 1.5 || d.getHours() % stepHours) continue
    ticks.push({ value, label: d.getHours() ? hourFmt.format(d) : dayFmt.format(d) })
  }
  return ticks
}

/** Which weather layer the map shows: forecast risk (0–48 h or to arrival), live radar, or none. */
export type MapLayer = 'forecast' | 'radar' | 'none'

export interface TruckStatusLine {
  text: string
  color: string | null // risk colour of the truck's stretch of road, when en route
}

interface Props {
  start: number | null // unix seconds of hour 0; null while loading
  maxHour: number // 48, or more when the trip arrives later
  timeline: HourSummary[] | null
  status: TruckStatusLine | null
  hour: number
  onHour: (hour: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  layer: MapLayer
  onLayer: (layer: MapLayer) => void
  radar: {
    scans: string[] | null // recent scan times, oldest first
    frame: number // playhead, fractional between scans while cross-fading
    onFrame: (frame: number) => void
    error: boolean
  }
  departHour: number | null
  arriveHour: number | null
  truckLevels: (number | null)[] | null
  loading: boolean
  error: boolean
}

export function HeatmapControls({
  start,
  maxHour,
  timeline,
  status,
  hour,
  onHour,
  playing,
  onPlaying,
  layer,
  onLayer,
  radar,
  departHour,
  arriveHour,
  truckLevels,
  loading,
  error,
}: Props) {
  // Speed is read through a ref, so changing it mid-playback doesn't restart the animation.
  const [speed, setSpeed] = useState(1)
  const speedRef = useRef(speed)
  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  // Animate with requestAnimationFrame so playback is as smooth as the display allows.
  useEffect(() => {
    if (!playing || layer === 'radar') return
    let frame = 0
    let last = performance.now()
    let current = hour
    const tick = (now: number) => {
      current += ((now - last) / 1000) * HOURS_PER_SECOND * speedRef.current
      last = now
      if (current >= maxHour) {
        onHour(maxHour)
        onPlaying(false)
        return
      }
      onHour(current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Restart only when play toggles; `hour` is read once as the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, layer])

  // The radar's own loop: unlike the forecast it repeats, because the interesting thing is the
  // direction the weather is travelling and you only see that on the second pass.
  const scanCount = radar.scans?.length ?? 0
  useEffect(() => {
    if (!playing || layer !== 'radar' || scanCount < 2) return
    const lastFrame = scanCount - 1
    let frame = 0
    let last = performance.now()
    let current = radar.frame >= lastFrame ? 0 : radar.frame
    const tick = (now: number) => {
      current += ((now - last) / 1000) * SCANS_PER_SECOND * speedRef.current
      last = now
      if (current >= lastFrame + RADAR_HOLD) current = 0
      radar.onFrame(Math.min(current, lastFrame))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // `radar.frame` is the starting point only, as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, layer, scanCount])

  const compact = useMediaQuery((theme) => theme.breakpoints.down('md'))
  const marks = useMemo(
    () =>
      start === null ? [] : clockTicks(start, (compact ? 12 : 6) * (maxHour > 60 ? 2 : 1), maxHour),
    [start, compact, maxHour],
  )
  const label =
    start === null ? '' : formatTime(new Date((start + hour * 3600) * 1000).toISOString())
  const visible = layer === 'forecast'
  const live = layer === 'radar'
  // Where the playhead sits, and how far back that scan is.
  const shownScan = radar.scans?.[Math.round(radar.frame)] ?? null
  const atLatestScan = scanCount > 0 && Math.round(radar.frame) === scanCount - 1
  const minutesAgo = shownScan
    ? Math.max(0, Math.round((Date.now() - Date.parse(shownScan)) / 60_000))
    : 0
  // One tick per scan: the loop is short enough that the ticks read as the scans themselves.
  const scanMarks = useMemo(
    () => Array.from({ length: scanCount }, (_, i) => ({ value: i })),
    [scanCount],
  )
  const loopMinutes =
    radar.scans && radar.scans.length > 1
      ? Math.round(
          (Date.parse(radar.scans[radar.scans.length - 1]) - Date.parse(radar.scans[0])) / 60_000,
        )
      : 0

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'absolute',
        left: 16,
        right: { xs: 16, md: 'auto' },
        bottom: 16,
        width: { md: 560 },
        px: { xs: 1.5, md: 2 },
        pt: { xs: 0.5, md: 1 },
        pb: { xs: 0.5, md: 1.5 },
        zIndex: 3, // above deck.gl's canvas (inside MapLibre's z-index 2 control layer)
        bgcolor: 'rgba(13, 30, 45, 0.9)',
        backdropFilter: 'blur(6px)',
        ...rise(),
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
          onClick={() => {
            if (!playing && !live && hour >= maxHour) onHour(0)
            onPlaying(!playing)
          }}
          disabled={live ? scanCount < 2 : !visible || start === null}
          size="small"
          color="primary"
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        {(visible || live) && (
          <Button
            size="small"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            disabled={live ? scanCount < 2 : start === null}
            aria-label={`Playback speed ${speed}×, change`}
            title="Playback speed"
            sx={{ minWidth: 0, px: 0.75, py: 0, fontFamily: monoFont, fontSize: 12 }}
          >
            {speed}×
          </Button>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
            {live ? (
              <>
                <Box
                  component="span"
                  sx={{
                    color: 'error.main',
                    mr: 0.75,
                    // Only the newest scan is "live"; scrub back and the pulse stops.
                    animation: atLatestScan ? 'radarPulse 2s ease-in-out infinite' : 'none',
                    '@keyframes radarPulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.35 },
                    },
                  }}
                >
                  ●
                </Box>
                Radar {shownScan && `· ${scanFmt.format(new Date(shownScan))}`}
                {shownScan && (
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                    {atLatestScan ? ' · live' : ` · ${minutesAgo} min ago`}
                  </Box>
                )}
              </>
            ) : (
              <>Weather risk {label && `· ${label}`}</>
            )}
          </Typography>
        </Box>
        {(live ? scanCount === 0 && !radar.error : loading) && (
          <CircularProgress size={16} aria-label="Loading weather layer" />
        )}
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layer === 'none' ? null : layer}
          onChange={(_, value: MapLayer | null) => {
            onPlaying(false)
            onLayer(value ?? 'none')
          }}
          aria-label="Weather layer"
          sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: 12 } }}
        >
          <ToggleButton value="forecast">Forecast</ToggleButton>
          <ToggleButton value="radar">Radar</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {/* Full width under the title (indented past the play button), so phones get room. */}
      <Box sx={{ pl: '42px', mt: { xs: -0.5, md: -0.75 } }}>
        {live ? (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: 'block', minHeight: { xs: '2lh', md: 0 } }}
          >
            {radar.error
              ? "Couldn't reach the NOAA radar service"
              : `Observed rain and snow intensity · last ${loopMinutes || 25} min, looping · US only`}
          </Typography>
        ) : (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', minWidth: 0 }}>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontFamily: monoFont, flexShrink: 0 }}
            >
              {`+${Math.floor(hour)} h`}
            </Typography>
            {!error && status?.color && (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  alignSelf: 'flex-start',
                  mt: '6px',
                  borderRadius: '50%',
                  bgcolor: status.color,
                  flexShrink: 0,
                }}
              />
            )}
            {/* Phones get two fixed lines so the panel never changes height during playback. */}
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: { xs: 2, md: 1 },
                minHeight: { xs: '2lh', md: 0 },
              }}
            >
              {error ? "Couldn't load the forecast heatmap" : status?.text}
            </Typography>
          </Stack>
        )}{' '}
      </Box>

      {live ? (
        <>
          <Box sx={{ px: 1, mt: 1 }}>
            <Slider
              aria-label="Radar scan"
              value={radar.frame}
              min={0}
              max={Math.max(scanCount - 1, 0)}
              // Fine enough to scrub through the cross-fade instead of snapping scan to scan.
              step={0.01}
              marks={scanMarks}
              disabled={scanCount < 2}
              onChange={(_, value) => {
                onPlaying(false)
                radar.onFrame(value as number)
              }}
              valueLabelDisplay="off"
              getAriaValueText={() =>
                shownScan ? `Radar scan of ${scanFmt.format(new Date(shownScan))}` : ''
              }
              track={false}
              sx={{
                '& .MuiSlider-rail': { opacity: 0.25 },
                '& .MuiSlider-mark': {
                  height: 6,
                  width: '1px',
                  bgcolor: tokens.textMuted,
                  opacity: 0.4,
                },
                // The playhead is driven by rAF; a CSS transition on top would smear it.
                '& .MuiSlider-thumb': { transition: 'none' },
                '& .MuiSlider-track': { transition: 'none' },
              }}
            />
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', mt: -0.5, mb: 0.5, px: 1 }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
              Light
            </Typography>
            <Box
              sx={{
                flex: 1,
                height: 8,
                borderRadius: 1,
                // The service's own ramp, so a cell on the map lands somewhere on this bar.
                background: `linear-gradient(90deg, ${DBZ_RAMP.join(', ')})`,
              }}
            />
            <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
              Hail
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: { xs: 'none', md: 'block' } }}
          >
            Radar shows what is falling now. Route dots stay on the forecast for when your truck
            gets there.
          </Typography>
        </>
      ) : (
        <>
          <Box sx={{ px: 1, mt: 1 }}>
            {timeline && (
              <RiskTimeline
                timeline={timeline}
                maxHour={maxHour}
                departHour={departHour}
                arriveHour={arriveHour}
                truckLevels={truckLevels}
                onHour={(h) => {
                  onPlaying(false)
                  onHour(h)
                }}
              />
            )}
            <Slider
              aria-label="Forecast hour"
              value={hour}
              min={0}
              max={maxHour}
              step={STEP}
              marks={marks}
              disabled={!visible || start === null}
              onChange={(_, value) => {
                onPlaying(false)
                onHour(value as number)
              }}
              valueLabelDisplay="off"
              getAriaValueText={() => (status ? `${label}. ${status.text}` : label)}
              track={false}
              sx={{
                mt: -0.5,
                mb: marks.length ? 2 : 0,
                '& .MuiSlider-rail': { opacity: 0.25 },
                '& .MuiSlider-mark': {
                  height: 6,
                  width: '1px',
                  bgcolor: tokens.textMuted,
                  opacity: 0.4,
                },
                '& .MuiSlider-markLabel': {
                  fontSize: 11,
                  fontFamily: monoFont,
                  color: 'text.secondary',
                  top: { xs: 22, md: 26 },
                },
                '& .MuiSlider-thumb': { transition: 'none' },
                '& .MuiSlider-track': { transition: 'none' },
              }}
            />
          </Box>
          {/* The legend also sits under the route list, so phones skip it here to keep the map visible. */}
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', flexWrap: 'wrap', display: { xs: 'none', md: 'flex' } }}
          >
            <RiskLegend dense />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Dots: weather when the truck gets there (ringed = around this hour) · Shading:
              weather at this hour, none = low · Bars: corridor at risk, by level · Trip line: your
              truck
            </Typography>
          </Stack>
        </>
      )}
    </Paper>
  )
}
