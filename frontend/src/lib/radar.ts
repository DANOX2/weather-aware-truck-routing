// Live US radar from NOAA's MRMS precipitation-type mosaic: free, keyless, CORS-enabled WMS,
// a new scan about every 2 minutes. It shows what is falling now, by type; the forecast risk
// heatmap stays the planning layer.

const WMS = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_pcpn_typ/ows'
export const RADAR_REFRESH_MS = 2 * 60 * 1000
export const RADAR_ATTRIBUTION =
  '<a href="https://www.nssl.noaa.gov/projects/mrms/" target="_blank">Radar © NOAA MRMS</a>'

// Colours sampled from the service's own legend, so the map and our legend always agree.
export const PRECIP_TYPES = [
  { label: 'Rain', color: '#0450A4' }, // warm stratiform
  { label: 'Cool rain', color: '#6EFFFF' }, // cool stratiform
  { label: 'Snow', color: '#C8C8C8' },
  { label: 'Storms', color: '#FF3232' }, // convective
  { label: 'Hail', color: '#960096' },
  { label: 'Tropical rain', color: '#00F900' },
  { label: 'Tropical storms', color: '#009700' },
] as const

/** Raster tile template for one scan; MapLibre fills in the tile's bounding box. */
export function radarTileUrl(time: string): string {
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    layers: 'conus_pcpn_typ',
    styles: '',
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    width: '256',
    height: '256',
    time,
  })
  return `${WMS}?${params}&bbox={bbox-epsg-3857}`
}

/** Time of the latest scan (ISO), read from the service's capabilities document. */
export async function latestRadarTime(signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${WMS}?service=WMS&request=GetCapabilities&version=1.3.0`, {
    signal,
  })
  if (!response.ok) throw new Error(`Radar service returned ${response.status}`)
  const xml = new DOMParser().parseFromString(await response.text(), 'text/xml')
  const time = [...xml.getElementsByTagName('Dimension')]
    .find((d) => d.getAttribute('name') === 'time')
    ?.getAttribute('default')
  if (!time) throw new Error('Radar service listed no scans')
  return time
}
