// Coarse "near <town>" labels, from public town coordinates (Washington towns only so far). Not a geocoder: a trail gets the
// nearest town on this list when one is within MAX_KM, else the name of the covered region it is in (from the data), else "in this area".
import { haversine, type LngLat } from '../../src/lib/geo';

export const PLACES: [string, number, number][] = [
  ['Seattle', -122.33, 47.61], ['Bellingham', -122.48, 48.75], ['Everett', -122.2, 47.98], ['Tacoma', -122.44, 47.25],
  ['Olympia', -122.9, 47.04], ['Issaquah', -122.03, 47.53], ['North Bend', -121.78, 47.5], ['Snoqualmie Pass', -121.41, 47.43],
  ['Leavenworth', -120.66, 47.6], ['Wenatchee', -120.31, 47.42], ['Index', -121.55, 47.82], ['Darrington', -121.6, 48.25],
  ['Ashford', -122.03, 46.75], ['Packwood', -121.67, 46.6], ['Randle', -122.0, 46.53], ['Cougar', -122.31, 46.06],
  ['Vancouver', -122.66, 45.64], ['Stevenson', -122.1, 45.69], ['Cle Elum', -120.94, 47.2], ['Ellensburg', -120.55, 46.99],
  ['Yakima', -120.51, 46.6], ['Spokane', -117.43, 47.66], ['Walla Walla', -118.34, 46.06], ['Pullman', -117.18, 46.73],
  ['Port Angeles', -123.43, 48.12], ['Forks', -124.38, 47.95], ['Sequim', -123.1, 48.08], ['Port Townsend', -122.76, 48.12],
  ['Aberdeen', -123.82, 46.98], ['Kelso', -122.9, 46.15], ['Bremerton', -122.63, 47.57], ['Anacortes', -122.61, 48.51],
  ['Concrete', -121.75, 48.54], ['Marblemount', -121.43, 48.53], ['Winthrop', -120.17, 48.48], ['Twisp', -120.12, 48.36],
  ['Chelan', -120.02, 47.84], ['Stehekin', -120.69, 48.31], ['Glacier', -121.95, 48.89], ['Sultan', -121.82, 47.86],
  ['Enumclaw', -121.99, 47.2], ['Carnation', -121.91, 47.65], ['Gig Harbor', -122.58, 47.33], ['Shelton', -123.1, 47.21],
  ['Republic', -118.74, 48.65], ['Colville', -117.9, 48.54], ['Kennewick', -119.14, 46.21], ['Moses Lake', -119.28, 47.13],
  ['Brinnon', -122.92, 47.68], ['Quilcene', -122.87, 47.82], ['Hoodsport', -123.14, 47.41], ['Skykomish', -121.36, 47.71],
  ['Granite Falls', -121.97, 48.09], ['Newhalem', -121.25, 48.67], ['Mazama', -120.43, 48.6], ['Trout Lake', -121.53, 46.0],
  ['Lake Quinault', -123.85, 47.47], ['Maple Falls', -122.07, 48.92], ['Monroe', -121.97, 47.86],
  ['Ocean Shores', -124.16, 47.0], ['Long Beach', -124.06, 46.35], ['Friday Harbor', -123.01, 48.53],
];
const MAX_KM = 35;

export function areaOf(p: LngLat, regionName?: string): string {
  let best: string | null = null, d = Infinity;
  for (const [name, lon, lat] of PLACES) {
    const m = haversine(p, [lon, lat]);
    if (m < d) { d = m; best = name; }
  }
  return best && d <= MAX_KM * 1000 ? `near ${best}, WA` : regionName ? `in ${regionName}` : 'in this area';
}
