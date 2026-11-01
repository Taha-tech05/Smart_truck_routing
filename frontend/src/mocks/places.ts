/** Fake autocomplete suggestions (UI only; the real app will call /api/geocode). */
export const MOCK_PLACES = [
  'Dallas, TX, USA',
  'Denver, CO, USA',
  'Fort Worth, TX, USA',
  'Austin, TX, USA',
  'Houston, TX, USA',
  'Amarillo, TX, USA',
  'Oklahoma City, OK, USA',
  'Wichita, KS, USA',
  'Albuquerque, NM, USA',
  'Salt Lake City, UT, USA',
  'Kansas City, MO, USA',
  'Phoenix, AZ, USA',
]

const COORDS: Record<string, [number, number]> = {
  'Dallas, TX, USA': [32.7767, -96.797],
  'Denver, CO, USA': [39.7392, -104.9903],
  'Fort Worth, TX, USA': [32.7555, -97.3308],
  'Austin, TX, USA': [30.2672, -97.7431],
  'Houston, TX, USA': [29.7604, -95.3698],
  'Amarillo, TX, USA': [35.222, -101.8313],
  'Oklahoma City, OK, USA': [35.4676, -97.5164],
  'Wichita, KS, USA': [37.6872, -97.3301],
  'Albuquerque, NM, USA': [35.0844, -106.6504],
  'Salt Lake City, UT, USA': [40.7608, -111.891],
  'Kansas City, MO, USA': [39.0997, -94.5786],
  'Phoenix, AZ, USA': [33.4484, -112.074],
}

export function mockGeocode(q: string) {
  const s = q.trim().toLowerCase()
  return MOCK_PLACES.filter((p) => p.toLowerCase().includes(s)).map((label) => ({
    label,
    lat: COORDS[label][0],
    lng: COORDS[label][1],
  }))
}
