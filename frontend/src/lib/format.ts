import type { Criterion, RiskLevel } from '../api/types.ts'

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  SEVERE: 'Severe',
  NO_TRAVEL: 'No travel',
}

export const ROUTE_NAMES = ['A', 'B', 'C', 'D', 'E'] as const

const timeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatTime = (iso: string) => timeFmt.format(new Date(iso))

export function formatDuration(seconds: number): string {
  // Round to whole minutes first, so 8 h 59.6 min reads "9 h 00 min", not "8 h 60 min".
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

export const formatMiles = (mi: number) =>
  `${mi.toLocaleString(undefined, { maximumFractionDigits: mi < 10 ? 1 : 0 })} mi`

export function formatCriterionValue(criterion: Criterion, route: {
  miles_by_level: Record<RiskLevel, number>
  avg_risk: number
  duration_s: number
}): string {
  switch (criterion) {
    case 'no_travel_miles':
      return formatMiles(route.miles_by_level.NO_TRAVEL)
    case 'severe_miles':
      return formatMiles(route.miles_by_level.SEVERE)
    case 'high_miles':
      return formatMiles(route.miles_by_level.HIGH)
    case 'avg_risk':
      return `${route.avg_risk.toFixed(2)} / 4`
    case 'duration':
      return formatDuration(route.duration_s)
  }
}

/** "UTC−05:00" for the user's current offset. */
export function utcOffsetLabel(date = new Date()): string {
  const minutes = -date.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export function nextQuarterHour(from = new Date()): Date {
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15)
  return d
}
