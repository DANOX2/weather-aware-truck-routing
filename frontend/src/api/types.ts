// Mirrors the Django API payloads (backend/routing/services.py, heatmap.py).

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' | 'NO_TRAVEL'
export const RISK_LEVELS: RiskLevel[] = ['LOW', 'MODERATE', 'HIGH', 'SEVERE', 'NO_TRAVEL']

export type Criterion = 'no_travel_miles' | 'severe_miles' | 'high_miles' | 'avg_risk' | 'duration'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface TripRequest {
  origin: Place
  destination: Place
  depart_at: string // ISO, with offset
  weight_lb: number
  interval_mi: 10 | 25 | 50
}

export interface Checkpoint {
  mile: number
  lat: number
  lon: number
  eta: string
  represents_mi: number
  level: RiskLevel | null // null = beyond the forecast horizon
  forecast_time: string | null
  drivers?: Array<'wind' | 'rain' | 'snow'>
  load_escalated?: boolean
  weather?: { wind_mph: number; gust_mph: number; rain_in_hr: number; snow_in_hr: number }
  levels?: { wind: RiskLevel; rain: RiskLevel; snow: RiskLevel }
}

export interface Route {
  id: number
  rank: number
  distance_mi: number
  duration_s: number
  traffic_delay_s: number
  departure: string
  arrival: string
  via_detour: boolean
  miles_by_level: Record<RiskLevel, number>
  avg_risk: number
  path: Array<[number, number]> // [lon, lat]
  checkpoints: Checkpoint[]
}

export interface Trip {
  routes: Route[]
  recommendation: {
    route_id: number
    criterion: Criterion | null
    label: string | null
    beats: Array<{ route_id: number; criterion: Criterion | null; label: string | null }>
    all_have_no_travel: boolean
  }
  interval_mi: number
  weight_lb: number
  wind_metric: 'gust' | 'sustained'
  demo?: boolean
}

export interface Heatmap {
  grid: { cell_deg: number; lat0: number; lon0: number; nx: number; ny: number }
  cells: number[]
  start: number // unix seconds, hour 0
  hours: number
  index_scale: number
  values: string // base64, values[h * cells.length + k]
  demo?: boolean
}
