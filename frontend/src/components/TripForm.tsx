import EditIcon from '@mui/icons-material/EditOutlined'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { type FormEvent, useState } from 'react'

import type { Place, TripRequest } from '../api/types.ts'
import { formatTime, nextQuarterHour, toLocalInput, utcOffsetLabel } from '../lib/format.ts'
import { tokens } from '../theme.ts'
import { PlaceAutocomplete } from './PlaceAutocomplete.tsx'

const MIN_WEIGHT = 1_000
const MAX_WEIGHT = 80_000
const HOURS_AHEAD = 48
const INTERVALS = [10, 25, 50] as const

// A real trip is ready on first visit, so the app can be tried with one click.
const SAMPLE = {
  origin: { label: 'Dallas, TX', lat: 32.7767, lon: -96.797 },
  destination: { label: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
  weight: 42_000,
}

interface Props {
  onSubmit: (trip: TripRequest) => void
  busy: boolean
  serverErrors?: Record<string, string[]>
  collapsed: boolean // show a one-line summary once results are on screen
  onEdit: () => void
}

type Errors = Partial<Record<'origin' | 'destination' | 'depart' | 'weight', string>>

function validate(
  origin: Place | null,
  destination: Place | null,
  depart: string,
  weight: number | null,
): Errors {
  const errors: Errors = {}
  if (!origin) errors.origin = 'Pick a starting point from the list'
  if (!destination) errors.destination = 'Pick a destination from the list'
  if (origin && destination && origin.lat === destination.lat && origin.lon === destination.lon)
    errors.destination = 'Destination must differ from the origin'

  const when = new Date(depart).getTime()
  const now = Date.now()
  if (Number.isNaN(when)) errors.depart = 'Pick a departure date and time'
  else if (when < now - 15 * 60_000) errors.depart = "Departure can't be in the past"
  else if (when > now + HOURS_AHEAD * 3_600_000)
    errors.depart = `Forecasts are reliable for ${HOURS_AHEAD} h — pick a time before then`

  if (weight === null) errors.weight = 'Enter the load weight'
  else if (weight < MIN_WEIGHT || weight > MAX_WEIGHT)
    errors.weight = `Between ${MIN_WEIGHT.toLocaleString()} and ${MAX_WEIGHT.toLocaleString()} lb`
  return errors
}

export function TripForm({ onSubmit, busy, serverErrors, collapsed, onEdit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(SAMPLE.origin)
  const [destination, setDestination] = useState<Place | null>(SAMPLE.destination)
  const [depart, setDepart] = useState(() => toLocalInput(nextQuarterHour()))
  const [weightText, setWeightText] = useState(SAMPLE.weight.toLocaleString())
  const [intervalMi, setIntervalMi] = useState<(typeof INTERVALS)[number]>(25)
  const [submitted, setSubmitted] = useState(false)
  // Picker bounds; validate() re-checks against the live clock on submit.
  const [bounds] = useState(() => ({
    min: toLocalInput(new Date()),
    max: toLocalInput(new Date(Date.now() + HOURS_AHEAD * 3_600_000)),
  }))

  const weight = weightText.trim() ? Number(weightText.replace(/[^\d]/g, '')) : null
  const errors = validate(origin, destination, depart, weight)
  const shown: Errors = submitted ? errors : {}
  const serverDepart = serverErrors?.depart_at?.[0]

  const submit = (trip: Partial<{ interval: (typeof INTERVALS)[number] }> = {}) => {
    setSubmitted(true)
    if (Object.keys(errors).length || !origin || !destination || weight === null) return
    onSubmit({
      origin,
      destination,
      depart_at: new Date(depart).toISOString(),
      weight_lb: weight,
      interval_mi: trip.interval ?? intervalMi,
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const intervalPicker = (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.75 }}>
        Check the weather every
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={intervalMi}
        onChange={(_, value) => {
          if (!value) return
          setIntervalMi(value)
          // Re-sampling is cheap (routes are cached server-side), so apply it right away.
          if (submitted) submit({ interval: value })
        }}
        aria-label="Weather checkpoint interval"
      >
        {INTERVALS.map((mi) => (
          <ToggleButton key={mi} value={mi}>
            {mi} mi
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  )

  if (collapsed && origin && destination) {
    return (
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            p: 1.5,
            pl: 2,
            borderRadius: 2.5,
            border: `1px solid ${tokens.border}`,
            bgcolor: tokens.surface,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
              {origin.label} → {destination.label}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Leaves {formatTime(new Date(depart).toISOString())} ·{' '}
              {weight?.toLocaleString()} lb
            </Typography>
          </Box>
          <Button size="small" startIcon={<EditIcon />} onClick={onEdit}>
            Edit trip
          </Button>
        </Stack>
        {intervalPicker}
      </Stack>
    )
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2}>
        <Box sx={{ position: 'relative' }}>
          <Stack spacing={1.5} sx={{ pr: 5 }}>
            <PlaceAutocomplete
              label="From"
              value={origin}
              onChange={setOrigin}
              error={shown.origin}
            />
            <PlaceAutocomplete
              label="To"
              value={destination}
              onChange={setDestination}
              error={shown.destination}
            />
          </Stack>
          <Tooltip title="Swap origin and destination">
            <IconButton
              aria-label="Swap origin and destination"
              onClick={() => {
                setOrigin(destination)
                setDestination(origin)
              }}
              sx={{ position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)' }}
            >
              <SwapVertIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <TextField
          label="Departure"
          type="datetime-local"
          value={depart}
          onChange={(e) => setDepart(e.target.value)}
          error={Boolean(shown.depart || serverDepart)}
          helperText={
            shown.depart ?? serverDepart ?? `Your local time (${utcOffsetLabel()}), up to 48 h ahead`
          }
          sx={{ '& input': { colorScheme: 'dark' } }}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: bounds }}
        />

        <TextField
          label="Load weight"
          value={weightText}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 6)
            setWeightText(digits ? Number(digits).toLocaleString() : '')
          }}
          error={Boolean(shown.weight)}
          helperText={
            shown.weight ?? (
              <>
                Over 30,000 lb, 45–54 mph winds become <b>No travel</b>. Over 40,000 lb, 35–44
                mph winds become <b>Severe</b>.
              </>
            )
          }
          slotProps={{
            htmlInput: { inputMode: 'numeric' },
            input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> },
          }}
        />

        {intervalPicker}

        <Button type="submit" variant="contained" size="large" disabled={busy}>
          {busy ? 'Planning…' : 'Find the safest route'}
        </Button>
      </Stack>
    </Box>
  )
}
