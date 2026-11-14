// ===== LEGAL CHECK: every metric (en-CA) string the app shows is in this one block =====
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
  lengthChips: { under3: 'Under 5 km', '3to6': '5–10 km', '6to10': '10–15 km', '10plus': '15+ km' },
} as const;
// ===== end of metric strings =====
