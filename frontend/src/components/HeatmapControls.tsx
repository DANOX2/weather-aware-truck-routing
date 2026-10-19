import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import {
  Box,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Paper,
  Slider,
  Stack,
  Switch,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useEffect, useMemo } from 'react'

import type { HourSummary } from '../lib/heatmap.ts'
import { formatTime } from '../lib/format.ts'
import { monoFont, tokens } from '../theme.ts'
import { RiskLegend } from './RiskLegend.tsx'
import { RiskTimeline } from './RiskTimeline.tsx'

const MAX_HOUR = 48
const STEP = 0.25 // quarter-hour steps; the map cross-fades between forecast hours
const PLAY_HOURS_PER_SECOND = 4

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

/** Slider ticks on local clock hours (every 6 h, or 12 h on phones); midnight shows the day. */
function clockTicks(start: number, stepHours: number) {
  const ticks = []
  const first = new Date(start * 1000)
  first.setMinutes(0, 0, 0)
  for (let d = first; ; d = new Date(d.getTime() + 3600_000)) {
    const value = (d.getTime() / 1000 - start) / 3600
    if (value > MAX_HOUR - 1.5) break
    if (value < 1.5 || d.getHours() % stepHours) continue
    ticks.push({ value, label: d.getHours() ? hourFmt.format(d) : dayFmt.format(d) })
  }
  return ticks
}

export interface TruckStatusLine {
  text: string
  color: string | null // risk colour of the truck's stretch of road, when en route
}

interface Props {
  start: number | null // unix seconds of hour 0; null while loading
  timeline: HourSummary[] | null
  status: TruckStatusLine | null
  hour: number
  onHour: (hour: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  visible: boolean
  onVisible: (visible: boolean) => void
  departHour: number | null
  arriveHour: number | null
  loading: boolean
  error: boolean
}

export function HeatmapControls({
  start,
  timeline,
  status,
  hour,
  onHour,
  playing,
  onPlaying,
  visible,
  onVisible,
  departHour,
  arriveHour,
  loading,
  error,
}: Props) {
  // Animate with requestAnimationFrame so playback is as smooth as the display allows.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    let current = hour
    const tick = (now: number) => {
      current += ((now - last) / 1000) * PLAY_HOURS_PER_SECOND
      last = now
      if (current >= MAX_HOUR) {
        onHour(MAX_HOUR)
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
  }, [playing])

  const compact = useMediaQuery((theme) => theme.breakpoints.down('md'))
  const marks = useMemo(
    () => (start === null ? [] : clockTicks(start, compact ? 12 : 6)),
    [start, compact],
  )
  const label =
    start === null ? '' : formatTime(new Date((start + hour * 3600) * 1000).toISOString())

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
        bgcolor: 'rgba(13, 30, 45, 0.9)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
          onClick={() => {
            if (!playing && hour >= MAX_HOUR) onHour(0)
            onPlaying(!playing)
          }}
          disabled={!visible || start === null}
          size="small"
          color="primary"
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
            Weather risk {label && `· ${label}`}
          </Typography>
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
        </Box>
        {loading && <CircularProgress size={16} aria-label="Loading heatmap" />}
        <FormControlLabel
          control={
            <Switch size="small" checked={visible} onChange={(e) => onVisible(e.target.checked)} />
          }
          label={<Typography variant="caption">Heatmap</Typography>}
          sx={{ mr: 0 }}
        />
      </Stack>

      <Box sx={{ px: 1, mt: 1 }}>
        {timeline && (
          <RiskTimeline
            timeline={timeline}
            maxHour={MAX_HOUR}
            departHour={departHour}
            arriveHour={arriveHour}
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
          max={MAX_HOUR}
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
            '& .MuiSlider-mark': { height: 6, width: '1px', bgcolor: tokens.textMuted, opacity: 0.4 },
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
          No shading = low risk · bars = share of the corridor at risk each hour
        </Typography>
      </Stack>
    </Paper>
  )
}
