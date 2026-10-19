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
} from '@mui/material'
import { useEffect } from 'react'

import { formatTime } from '../lib/format.ts'
import { monoFont } from '../theme.ts'
import { RiskLegend } from './RiskLegend.tsx'

const MAX_HOUR = 48
const STEP = 0.25 // quarter-hour steps; the map cross-fades between forecast hours
const PLAY_HOURS_PER_SECOND = 4

interface Props {
  start: number | null // unix seconds of hour 0; null while loading
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

  const label = start === null ? '' : formatTime(new Date((start + hour * 3600) * 1000).toISOString())
  const marks = [
    ...(departHour !== null ? [{ value: departHour, label: 'Depart' }] : []),
    ...(arriveHour !== null && arriveHour <= MAX_HOUR ? [{ value: arriveHour, label: 'Arrive' }] : []),
  ]

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'absolute',
        left: 16,
        right: { xs: 16, md: 'auto' },
        bottom: 16,
        width: { md: 560 },
        px: 2,
        pt: 1,
        pb: 1.5,
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
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: monoFont }}>
            {error
              ? "Couldn't load the forecast heatmap"
              : `+${Math.floor(hour)} h from now`}
          </Typography>
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

      <Box sx={{ px: 1 }}>
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
          getAriaValueText={() => label}
          sx={{
            mt: 0.5,
            mb: marks.length ? 2 : 0,
            '& .MuiSlider-markLabel': { fontSize: 11, color: 'text.secondary' },
            '& .MuiSlider-thumb': { transition: 'none' },
            '& .MuiSlider-track': { transition: 'none' },
          }}
        />
      </Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <RiskLegend dense />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          No shading = low risk
        </Typography>
      </Stack>
    </Paper>
  )
}
