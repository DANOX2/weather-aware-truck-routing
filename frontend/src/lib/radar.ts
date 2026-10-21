// Live US radar from NOAA's MRMS composite reflectivity mosaic: free, keyless, CORS-enabled WMS.
// A scan lands about every 2 minutes and the service keeps two hours of them, so the map can loop
// recent scans instead of holding one frozen image. Reflectivity (dBZ) shades intensity
// continuously, from drizzle to hail; the forecast risk heatmap stays the planning layer.

const LAYER = 'conus_cref_qcd'
const WMS = `https://opengeo.ncep.noaa.gov/geoserver/conus/${LAYER}/ows`

/** Scans kept in the loop: 12 at the ~2 min cadence is about the last 25 minutes of weather. */
export const RADAR_FRAMES = 12
/** A scan lands every ~2 min, so re-read the list that often while the radar is on. */
export const RADAR_REFRESH_MS = 2 * 60 * 1000
export const RADAR_ATTRIBUTION =
  '<a href="https://www.nssl.noaa.gov/projects/mrms/" target="_blank">Radar © NOAA MRMS</a>'

// The ramp the service paints with, sampled from its own GetLegendGraphic so the map and the
// legend can never drift apart. The palette rides inside the GRIB rather than the style document,
// which exposes no dBZ breakpoints to label, so the legend names the ends instead of guessing
// numbers onto them.
export const DBZ_RAMP = [
  '#8f8574', // clear-air specks and the lightest returns
  '#cacba7',
  '#9ba2b5',
  '#4b64a1', // light rain
  '#5799c3',
  '#5bb8c3',
  '#41d67d',
  '#20d639', // steady rain
  '#0b7d0e',
  '#bfc002',
  '#fad60c', // heavy
  '#fab20c',
  '#e70405', // downpour
  '#a60c0d',
  '#ea74fd', // hail
  '#9700f1',
  '#6f00dd',
] as const

/** Raster tile template for one scan; MapLibre fills in the tile's bounding box. */
export function radarTileUrl(time: string): string {
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    layers: LAYER,
    styles: '',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    width: '256',
    height: '256',
    time,
    // A tile covers far more ground than 256 px at the zooms a cross-country route sits at, so
    // the service is downsampling a ~1 km grid. Its default is nearest neighbour, which keeps
    // the raw cell squares and the speckle between them; resampling instead rounds a storm's
    // edge and grades the steps between dBZ shades. GeoServer vendor parameter, and the single
    // biggest difference between this reading as data and reading as weather.
    interpolations: 'bicubic',
  })
  return `${WMS}?${params}&bbox={bbox-epsg-3857}`
}

/**
 * The most recent scan times (ISO, oldest first) from the service's capabilities document.
 * The time dimension lists every scan it still holds; the loop only wants the tail.
 */
export async function radarScans(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${WMS}?service=WMS&request=GetCapabilities&version=1.3.0`, {
    signal,
  })
  if (!response.ok) throw new Error(`Radar service returned ${response.status}`)
  const xml = new DOMParser().parseFromString(await response.text(), 'text/xml')
  const dimension = [...xml.getElementsByTagName('Dimension')].find(
    (d) => d.getAttribute('name') === 'time',
  )
  const scans = (dimension?.textContent ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (!scans.length) throw new Error('Radar service listed no scans')
  return scans.slice(-RADAR_FRAMES)
}
