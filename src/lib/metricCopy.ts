// ===== Metric (en-CA) strings, pending wording review: all of them are in this one block =====
// Metric follows the same rules as imperial: distance is always the whole outing ("round trip"), climb is rounded
// and, on Home cards, prefixed "About". Nothing here is a claim about a trail beyond what the imperial copy says.
export const METRIC_COPY = {
  roundTrip: (km: string) => `${km} km round trip`,   // Home card and list card
  gainAbout: (m: string) => `About ${m} m gain`,       // Home card, climb rounded to the nearest 10 m
  gain: (m: string) => `${m} m gain`,                  // list card
  tileRoundTrip: 'km round trip',                       // trail page tile label
  tileGain: 'm gain',                                   // trail page tile label
  awayUnder: 'Under 1 km away',
  away: (km: number) => `${km} km away`,
  timeNote: 'Time assumes 4.8 km/h plus 30 min per 300 m up.',
  shortChip: 'Under 5 km',                              // Find quick filter
  viewSub: 'Under 5 km, views tagged in OpenStreetMap', // Home row "Short with a view"
  elevAria: (a: string, b: string, peak: string) => `Elevation from ${a} to ${b} metres, peaking at ${peak} metres`, // trail page chart
  elevStart: '0 km',
  elevHigh: (m: string) => `High point ${m} m`,
  elevEnd: (km: string) => `${km} km`,
  gpsWarming: (m: number) => `GPS warming up ±${m} m`,                 // Navigate status
  gps: (quality: string, m: number) => `GPS ${quality} ±${m} m`,        // Navigate status
  tapInside: (m: number) => `Tap inside the circle around your dot (about ${m} m).`,
  pointOutside: (m: number) => `That trail point is outside the circle around your dot (about ${m} m).`,
  recordUnit: 'km',                                                      // Record: big number label and past-hike rows
  lengthChips: { under3: 'Under 5 km', '3to6': '5–10 km', '6to10': '10–15 km', '10plus': '15+ km' },
} as const;
// ===== end of metric strings =====
