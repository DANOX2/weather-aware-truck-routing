import PlaceIcon from '@mui/icons-material/PlaceOutlined'
import { Autocomplete, Box, CircularProgress, InputAdornment, TextField } from '@mui/material'
import { useEffect, useState } from 'react'

import { searchPlaces } from '../api/client.ts'
import type { Place } from '../api/types.ts'

const DEBOUNCE_MS = 300
const MIN_CHARS = 3

interface Props {
  label: string
  value: Place | null
  onChange: (place: Place | null) => void
  error?: string
  autoFocus?: boolean
}

export function PlaceAutocomplete({ label, value, onChange, error, autoFocus }: Props) {
  const [input, setInput] = useState(value?.label ?? '')
  const [options, setOptions] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const query = input.trim()
  // Only search while the user is typing something new; a picked place needs no lookup.
  const searching = query.length >= MIN_CHARS && query !== value?.label

  useEffect(() => {
    if (!searching) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setFailed(false)
      searchPlaces(query, controller.signal)
        .then(setOptions)
        .catch(() => !controller.signal.aborted && setFailed(true))
        .finally(() => !controller.signal.aborted && setLoading(false))
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, searching])

  const noOptionsText =
    query.length < MIN_CHARS
      ? 'Type at least 3 letters'
      : failed
        ? "Couldn't search places. Check your connection."
        : 'No matching places'

  return (
    <Autocomplete
      value={value}
      onChange={(_, place) => onChange(place)}
      inputValue={input}
      onInputChange={(_, text) => setInput(text)}
      options={searching ? options : value ? [value] : []}
      filterOptions={(x) => x} // the server already filters
      getOptionLabel={(p) => p.label}
      isOptionEqualToValue={(a, b) => a.lat === b.lat && a.lon === b.lon}
      loading={searching && loading}
      noOptionsText={noOptionsText}
      autoHighlight
      forcePopupIcon={false}
      renderOption={({ key, ...props }, place) => (
        <Box component="li" key={`${key}-${place.lat}-${place.lon}`} {...props}>
          <PlaceIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
          {place.label}
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          error={Boolean(error)}
          helperText={error}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {searching && loading && (
                    <InputAdornment position="end">
                      <CircularProgress size={16} />
                    </InputAdornment>
                  )}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  )
}
