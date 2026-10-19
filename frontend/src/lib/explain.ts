import type { Checkpoint, Trip } from '../api/types.ts'
import { ROUTE_NAMES, formatCriterionValue } from './format.ts'

const PHRASES = {
  no_travel_miles: 'avoids No-travel weather',
  severe_miles: 'fewer Severe miles',
  high_miles: 'fewer High miles',
  avg_risk: 'lower overall risk',
  duration: 'faster',
} as const

/** One line per alternative: why the recommended route ranked above it. */
export function explainRecommendation(trip: Trip): string[] {
  const winner = trip.routes.find((r) => r.id === trip.recommendation.route_id)
  if (!winner) return []
  return trip.recommendation.beats.map(({ route_id, criterion }) => {
    const other = trip.routes.find((r) => r.id === route_id)!
    const name = ROUTE_NAMES[route_id]
    if (!criterion) return `Ties with Route ${name} on every measure.`
    return `vs Route ${name}: ${PHRASES[criterion]} (${formatCriterionValue(
      criterion,
      winner,
    )} vs ${formatCriterionValue(criterion, other)})`
  })
}

const num = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })

/** Plain-language cause of a checkpoint's level, e.g. "38 mph gusts with a 42,000 lb load". */
export function describeCause(
  cp: Checkpoint,
  weightLb: number,
  windMetric: Trip['wind_metric'],
): string {
  if (!cp.level || !cp.weather) return 'Beyond the forecast range — not scored'
  const w = cp.weather
  const wind =
    windMetric === 'gust' ? `${num(w.gust_mph)} mph gusts` : `${num(w.wind_mph)} mph wind`
  if (cp.level === 'LOW') {
    const wet = w.snow_in_hr > 0 ? 'light snow' : w.rain_in_hr > 0 ? 'light rain' : 'dry'
    return `${wind}, ${wet}`
  }
  const parts = (cp.drivers ?? []).map((driver) => {
    if (driver === 'wind')
      return cp.load_escalated ? `${wind} with a ${num(weightLb)} lb load` : wind
    if (driver === 'rain') return `${num(w.rain_in_hr, 2)} in/hr rain`
    return `${num(w.snow_in_hr, 1)} in/hr snow`
  })
  return parts.join(' and ')
}
