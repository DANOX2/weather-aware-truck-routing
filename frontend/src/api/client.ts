import type { Heatmap, Place, Trip, TripRequest } from './types.ts'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

// Stable error codes from the API, turned into words a driver understands.
const MESSAGES: Record<string, string> = {
  no_route: 'No truck-legal route connects these two places. Try a nearby city.',
  rate_limited: 'The routing service is busy right now. Try again in a minute.',
  routing_unavailable: "We couldn't reach the routing service. Try again.",
  weather_unavailable: "We couldn't load the forecast. Try again.",
  weather_rate_limited: 'The weather service is busy right now. Try again in a minute.',
  not_configured: 'Routing is not configured on this server.',
  network: 'No connection to the server. Check your internet and try again.',
}

export class ApiError extends Error {
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(code: string, message: string, fields: Record<string, string[]> = {}) {
    super(message)
    this.code = code
    this.fields = fields
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('network', MESSAGES.network)
  }
  const body = await response.json().catch(() => ({}))
  if (response.ok) return body as T

  if (response.status === 400) {
    // DRF validation errors: { field: [messages] } or { non_field_errors: [...] }
    const fields = body as Record<string, string[]>
    const first = Object.values(fields).flat()[0]
    throw new ApiError('validation', first ?? 'Please check the trip details.', fields)
  }
  const code = typeof body.code === 'string' ? body.code : 'routing_unavailable'
  throw new ApiError(code, MESSAGES[code] ?? MESSAGES.routing_unavailable)
}

export function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  return request<{ results: Place[] }>(`/api/geocode/?q=${encodeURIComponent(query)}`, {
    signal,
  }).then((r) => r.results)
}

export function planTrip(trip: TripRequest): Promise<Trip> {
  return request<Trip>('/api/trips/', { method: 'POST', body: JSON.stringify(trip) })
}

/** Corridor risk from now to 48 h, or to `until` (the latest arrival) when that's later. */
export function fetchHeatmap(
  paths: Trip['routes'][number]['path'][],
  weightLb: number,
  until: string,
) {
  return request<Heatmap>('/api/heatmap/', {
    method: 'POST',
    body: JSON.stringify({ paths, weight_lb: weightLb, until }),
  })
}
