import type { Heatmap, Route } from '../api/types.ts'
import { riskColors } from '../theme.ts'

// Continuous risk index (0–4) → colour. Stops sit on the risk levels, so the heatmap and the
// checkpoint dots always agree. Low risk stays unshaded (shading only starts just below the
// Moderate threshold), so a tint always means "Moderate or worse".
const STOPS: Array<[number, string, number]> = [
  [0, riskColors.MODERATE, 0],
  [0.8, riskColors.MODERATE, 0],
  [1, riskColors.MODERATE, 120],
  [2, riskColors.HIGH, 160],
  [3, riskColors.SEVERE, 190],
  [4, riskColors.NO_TRAVEL, 210],
]
const UPSCALE = 8 // cells → pixels before bilinear smoothing

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
const STOP_RGB = STOPS.map(([, hex]) => hexToRgb(hex))

export function colorForIndex(index: number): [number, number, number, number] {
  let i = 0
  while (i < STOPS.length - 2 && index >= STOPS[i + 1][0]) i++
  const [from, to] = [STOPS[i][0], STOPS[i + 1][0]]
  const t = Math.min(Math.max((index - from) / (to - from), 0), 1)
  const [a, b] = [STOP_RGB[i], STOP_RGB[i + 1]]
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    STOPS[i][2] + (STOPS[i + 1][2] - STOPS[i][2]) * t,
  ]
}

export interface HeatmapFrames {
  frames: HTMLCanvasElement[] // one per forecast hour
  bounds: [number, number, number, number] // [west, south, east, north]
  start: number // unix seconds of frame 0
}

/** Decode the packed API payload and paint one smoothed image per hour. */
export function buildFrames(heatmap: Heatmap): HeatmapFrames {
  const { grid, cells, hours, index_scale: scale } = heatmap
  const bytes = Uint8Array.from(atob(heatmap.values), (c) => c.charCodeAt(0))
  const frames: HTMLCanvasElement[] = []

  // One transparent cell of padding on each side, so smoothing fades out at the edges.
  const width = grid.nx + 2
  const height = grid.ny + 2
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const smallCtx = small.getContext('2d')!

  for (let h = 0; h < hours; h++) {
    const image = smallCtx.createImageData(width, height)
    cells.forEach((cell, k) => {
      const row = Math.floor(cell / grid.nx)
      const col = cell % grid.nx + 1
      const y = grid.ny - row // cells count from the south; images from the top (+1 padding)
      const [r, g, b, a] = colorForIndex(bytes[h * cells.length + k] / scale)
      image.data.set([r, g, b, a], (y * width + col) * 4)
    })
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
  }
}

/** Where the truck is on a route at a unix time, interpolated between checkpoints. */
export function truckPosition(route: Route, unixSeconds: number): [number, number] | null {
  const cps = route.checkpoints
  const times = cps.map((cp) => Date.parse(cp.eta) / 1000)
  if (unixSeconds < times[0] || unixSeconds > times[times.length - 1]) return null
  const i = Math.max(
    0,
    times.findIndex((t) => t >= unixSeconds),
  )
  if (i === 0) return [cps[0].lon, cps[0].lat]
  const t = (unixSeconds - times[i - 1]) / (times[i] - times[i - 1] || 1)
  return [
    cps[i - 1].lon + (cps[i].lon - cps[i - 1].lon) * t,
    cps[i - 1].lat + (cps[i].lat - cps[i - 1].lat) * t,
  ]
}
