import type { Checkpoint, Heatmap, Route } from '../api/types.ts'
import { riskColors } from '../theme.ts'

// Continuous risk index (0–4) → colour. Each level keeps its own hue, so a cell's colour is
// essentially its checkpoint level (the same as the dots and the legend); a higher position
// inside the level only deepens the opacity. Low stays unshaded, so a tint always means
// "Moderate or worse".
const LEVELS: Array<[string, number, number]> = [
  // [colour, alpha at the bottom of the level, alpha at the top]
  [riskColors.MODERATE, 110, 150],
  [riskColors.HIGH, 150, 180],
  [riskColors.SEVERE, 180, 205],
  [riskColors.NO_TRAVEL, 210, 210],
]

// Hues cross-fade, but only within BLEND of a level edge. Blending across the whole band is what
// used to make the top of Moderate read as High, so the bulk of every band — about three
// quarters of it — stays its own exact colour, and the change between two bands arrives as a
// soft edge instead of a drawn line. Measured in index units, so every boundary gets the same
// width whatever the local gradient.
const BLEND = 0.12
// The outer rim of any shaded area sits at index 1.0, where alpha jumped straight from 0 to 110
// and cut a hard line against the unshaded Low ground around it. Fading in across the very
// bottom of Moderate feathers that rim without tinting anything that is actually Low.
const ENTRY = 0.1

// Cells are half a degree, about 34 miles, so this picture is always an interpolation between
// coarse samples. What it must not do is interpolate the *colours*: blending premultiplied RGBA
// across a level boundary pulls hue and alpha together and leaves a muddy fringe, which is what
// the old canvas upscale did at every edge. So the smoothing happens on the risk index, in value
// space, and colour is applied once per output pixel afterwards. Level edges then stay crisp and
// read as contours the way a weather product should, while the field inside a band stays smooth.
const UPSCALE = 10 // cells → pixels, Catmull-Rom; the GPU's own filtering takes it from there
const PAD = 2 // blank cells kept around the corridor so the field has room to fade out
const INPAINT_PASSES = 2 // rings the corridor's values spread into that blank margin

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
const LEVEL_RGB = LEVELS.map(([hex]) => hexToRgb(hex))

export function colorForIndex(index: number): [number, number, number, number] {
  if (index <= 1) return [...LEVEL_RGB[0], 0]
  const level = Math.min(Math.floor(index), LEVELS.length) - 1
  const t = Math.min(index - 1 - level, 1)
  const [, from, to] = LEVELS[level]
  let [r, g, b] = LEVEL_RGB[level]

  // Each edge is shared by the two bands that meet at it, so each side carries half the mix:
  // both reach 0.5 exactly at the boundary and the two halves meet without a seam.
  if (t > 1 - BLEND && level + 1 < LEVELS.length) {
    const mix = (t - (1 - BLEND)) / (2 * BLEND)
    const [nr, ng, nb] = LEVEL_RGB[level + 1]
    r += (nr - r) * mix
    g += (ng - g) * mix
    b += (nb - b) * mix
  } else if (t < BLEND && level > 0) {
    const mix = (BLEND - t) / (2 * BLEND)
    const [pr, pg, pb] = LEVEL_RGB[level - 1]
    r += (pr - r) * mix
    g += (pg - g) * mix
    b += (pb - b) * mix
  }

  return [r, g, b, (from + (to - from) * t) * Math.min((index - 1) / ENTRY, 1)]
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

// Colour is a pure function of the index, so bake it into a table rather than calling
// colorForIndex per pixel: at this upscale that was a couple of million short-lived tuples per
// heatmap, and it dominated the cost of building the frames.
const LUT_STEPS = 1024
const INDEX_TO_LUT = (LUT_STEPS - 1) / 4
const COLOR_LUT = (() => {
  const lut = new Uint8ClampedArray(LUT_STEPS * 4)
  for (let i = 0; i < LUT_STEPS; i++) {
    lut.set(colorForIndex(i / INDEX_TO_LUT), i * 4)
  }
  return lut
})()

/** Catmull-Rom weights for a sample `t` of the way between the middle two of four points. */
function cubicWeights(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ]
}

/**
 * Catmull-Rom upsample of a scalar field, done separably (rows, then columns) so an output pixel
 * costs eight taps instead of sixteen. Bicubic rounds the blobs that bilinear leaves
 * diamond-shaped, which is most of why the old heatmap read as low-resolution.
 */
function resample(src: Float32Array, w: number, h: number, scale: number): Float32Array {
  const W = w * scale
  const H = h * scale
  const rows = new Float32Array(W * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) / scale - 0.5
      const x0 = Math.floor(sx)
      const wts = cubicWeights(sx - x0)
      let sum = 0
      for (let k = -1; k <= 2; k++) {
        sum += src[y * w + clamp(x0 + k, 0, w - 1)] * wts[k + 1]
      }
      rows[y * W + x] = sum
    }
  }
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / scale - 0.5
    const y0 = Math.floor(sy)
    const wts = cubicWeights(sy - y0)
    for (let x = 0; x < W; x++) {
      let sum = 0
      for (let k = -1; k <= 2; k++) {
        sum += rows[clamp(y0 + k, 0, h - 1) * W + x] * wts[k + 1]
      }
      out[y * W + x] = sum
    }
  }
  return out
}

/**
 * Spread the corridor's values outwards a ring at a time. Without this the smoothing blends real
 * weather against zero in the blank margin, so every corridor edge slid toward Low whether the
 * weather did or not. Coverage, below, is what fades the edge out — not the value.
 */
function inpaint(field: Float32Array, known: Uint8Array, w: number, h: number) {
  const filled = Uint8Array.from(known)
  for (let pass = 0; pass < INPAINT_PASSES; pass++) {
    const next = Uint8Array.from(filled)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (filled[i]) continue
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
            const j = yy * w + xx
            if (!filled[j]) continue
            sum += field[j]
            n++
          }
        }
        if (n) {
          field[i] = sum / n
          next[i] = 1
        }
      }
    }
    filled.set(next)
  }
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

  const width = grid.nx + PAD * 2
  const height = grid.ny + PAD * 2
  const W = width * UPSCALE
  const H = height * UPSCALE

  // Which cells the corridor covers never changes between hours, so the mask and its smoothed
  // version are built once and reused by every frame.
  const known = new Uint8Array(width * height)
  const offsets = cells.map((cell) => {
    const row = Math.floor(cell / grid.nx)
    const col = (cell % grid.nx) + PAD
    const y = grid.ny - 1 - row + PAD // cells count from the south, images from the top
    const i = y * width + col
    known[i] = 1
    return i
  })
  const coverage = resample(Float32Array.from(known), width, height, UPSCALE)

  const field = new Float32Array(width * height)
  for (let h = 0; h < hours; h++) {
    field.fill(0)
    let atRisk = 0
    const counts = [0, 0, 0, 0]
    offsets.forEach((offset, k) => {
      const index = bytes[h * cells.length + k] / scale
      if (index >= 1) {
        atRisk++
        counts[Math.min(Math.floor(index), 4) - 1]++
      }
      field[offset] = index
    })
    const total = cells.length || 1
    timeline.push({ atRisk: atRisk / total, shares: counts.map((n) => n / total) })

    inpaint(field, known, width, height)
    const smooth = resample(field, width, height, UPSCALE)

    const frame = document.createElement('canvas')
    frame.width = W
    frame.height = H
    const ctx = frame.getContext('2d')!
    const image = ctx.createImageData(W, H)
    const pixels = image.data
    for (let i = 0; i < W * H; i++) {
      // Catmull-Rom overshoots either side of a sharp edge; clamping it back is what stops the
      // ringing from inventing a band the data never reached.
      const q = ((clamp(smooth[i], 0, 4) * INDEX_TO_LUT + 0.5) | 0) * 4
      const alpha = COLOR_LUT[q + 3]
      if (!alpha) continue // Low, and everything past the corridor's fade-out
      const p = i * 4
      pixels[p] = COLOR_LUT[q]
      pixels[p + 1] = COLOR_LUT[q + 1]
      pixels[p + 2] = COLOR_LUT[q + 2]
      pixels[p + 3] = alpha * clamp(coverage[i], 0, 1)
    }
    ctx.putImageData(image, 0, 0)
    frames.push(frame)
  }

  return {
    frames,
    bounds: [
      grid.lon0 - PAD * grid.cell_deg,
      grid.lat0 - PAD * grid.cell_deg,
      grid.lon0 + (grid.nx + PAD) * grid.cell_deg,
      grid.lat0 + (grid.ny + PAD) * grid.cell_deg,
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
