import type { Checkpoint, Heatmap, Route } from '../api/types.ts'
import { riskColors } from '../theme.ts'

// Continuous risk index (0–4) → colour. Each level keeps its own hue, so a cell's colour is
// exactly its checkpoint level (the same as the dots and the legend); a higher position inside
// the level only deepens the opacity. Blending hues between levels made the top of Moderate
// look High. Low stays unshaded, so a tint always means "Moderate or worse".
const LEVELS: Array<[string, number, number]> = [
  // [colour, alpha at the bottom of the level, alpha at the top]
  [riskColors.MODERATE, 110, 150],
  [riskColors.HIGH, 150, 180],
  [riskColors.SEVERE, 180, 205],
  [riskColors.NO_TRAVEL, 210, 210],
]
const UPSCALE = 8 // cells → pixels before bilinear smoothing

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
const LEVEL_RGB = LEVELS.map(([hex]) => hexToRgb(hex))

export function colorForIndex(index: number): [number, number, number, number] {
  if (index < 1) return [...LEVEL_RGB[0], 0]
  const level = Math.min(Math.floor(index), LEVELS.length) - 1
  const t = Math.min(index - 1 - level, 1)
  const [, from, to] = LEVELS[level]
  return [...LEVEL_RGB[level], from + (to - from) * t]
}

export interface HeatmapFrames {
  frames: HTMLCanvasElement[] // one per forecast hour
  bounds: [number, number, number, number] // [west, south, east, north]
  start: number // unix seconds of frame 0
  timeline: HourSummary[] // one per forecast hour, for the risk-over-time chart
}

export interface HourSummary {
  atRisk: number // share of corridor cells at Moderate or worse, 0–1
  shares: number[] // share of corridor cells at Moderate, High, Severe and No travel
}

/** Decode the packed API payload and paint one smoothed image per hour. */
export function buildFrames(heatmap: Heatmap): HeatmapFrames {
  const { grid, cells, hours, index_scale: scale } = heatmap
  const bytes = Uint8Array.from(atob(heatmap.values), (c) => c.charCodeAt(0))
  const frames: HTMLCanvasElement[] = []
  const timeline: HourSummary[] = []

  // One transparent cell of padding on each side, so smoothing fades out at the edges.
  const width = grid.nx + 2
  const height = grid.ny + 2
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const smallCtx = small.getContext('2d')!

  for (let h = 0; h < hours; h++) {
    const image = smallCtx.createImageData(width, height)
    let atRisk = 0
    const counts = [0, 0, 0, 0]
    cells.forEach((cell, k) => {
      const row = Math.floor(cell / grid.nx)
      const col = cell % grid.nx + 1
      const y = grid.ny - row // cells count from the south; images from the top (+1 padding)
      const index = bytes[h * cells.length + k] / scale
      if (index >= 1) {
        atRisk++
        counts[Math.min(Math.floor(index), 4) - 1]++
      }
      const [r, g, b, a] = colorForIndex(index)
      image.data.set([r, g, b, a], (y * width + col) * 4)
    })
    const total = cells.length || 1
    timeline.push({ atRisk: atRisk / total, shares: counts.map((n) => n / total) })
    smallCtx.putImageData(image, 0, 0)

    const frame = document.createElement('canvas')
    frame.width = width * UPSCALE
    frame.height = height * UPSCALE
    const ctx = frame.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(small, 0, 0, frame.width, frame.height)
    frames.push(frame)
  }

  return {
    frames,
    bounds: [
      grid.lon0 - grid.cell_deg,
      grid.lat0 - grid.cell_deg,
      grid.lon0 + (grid.nx + 1) * grid.cell_deg,
      grid.lat0 + (grid.ny + 1) * grid.cell_deg,
    ],
    start: heatmap.start,
    timeline,
  }
}

export type TruckStatus =
  | { phase: 'before' | 'arrived' }
  | { phase: 'en-route'; position: [number, number]; mile: number; checkpoint: Checkpoint }

// Cumulative length (in degrees, longitude scaled by latitude) at each vertex of a route's path.
const pathLengths = new WeakMap<Route, number[]>()

/** The point `share` (0–1) of the way along the drawn route, so the truck stays on the road. */
export function pointAlongPath(route: Route, share: number): [number, number] {
  const path = route.path
  if (path.length < 2) return path[0]
  let lengths = pathLengths.get(route)
  if (!lengths) {
    lengths = [0]
    for (let i = 1; i < path.length; i++) {
      const [[lon0, lat0], [lon1, lat1]] = [path[i - 1], path[i]]
      const dx = (lon1 - lon0) * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180)
      lengths.push(lengths[i - 1] + Math.hypot(dx, lat1 - lat0))
    }
    pathLengths.set(route, lengths)
  }
  const target = Math.min(Math.max(share, 0), 1) * lengths[lengths.length - 1]
  let lo = 1
  let hi = lengths.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] < target) lo = mid + 1
    else hi = mid
  }
  const t = (target - lengths[lo - 1]) / (lengths[lo] - lengths[lo - 1] || 1)
  const [a, b] = [path[lo - 1], path[lo]]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Where the truck is on a route at a unix time: its mile by ETA, placed along the road. */
export function truckStatus(route: Route, unixSeconds: number): TruckStatus {
  const cps = route.checkpoints
  const times = cps.map((cp) => Date.parse(cp.eta) / 1000)
  if (unixSeconds < times[0]) return { phase: 'before' }
  if (unixSeconds > times[times.length - 1]) return { phase: 'arrived' }
  const i = Math.max(
    1,
    times.findIndex((t) => t >= unixSeconds),
  )
  const [a, b] = [cps[i - 1], cps[i]]
  const t = (unixSeconds - times[i - 1]) / (times[i] - times[i - 1] || 1)
  const mile = a.mile + (b.mile - a.mile) * t
  return {
    phase: 'en-route',
    // Interpolating between checkpoints in a straight line cut corners off the road.
    position: pointAlongPath(route, mile / (cps[cps.length - 1].mile || 1)),
    mile,
    // The checkpoint whose stretch of road the truck is on (each covers half-way to neighbours).
    checkpoint: t < 0.5 ? a : b,
  }
}
