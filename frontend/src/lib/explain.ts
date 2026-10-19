import type { Trip } from '../api/types.ts'
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
