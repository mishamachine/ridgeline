# Ridgeline

Bold, simple trail maps that work offline. An installable web app (PWA) in the "Swiss Field Guide" style.

**Milestone 1, the core loop:**
- **Find:** trails from OpenStreetMap near you or any place you search.
- **Trail detail:** distance, climb, estimated time, difficulty and an elevation profile.
- **Save offline:** stores the route, profile and map for the trail's area on the phone.
- **Navigate:** live GPS with miles left, time left, climb ahead and an off-route alert. Also includes reverse direction and keep-screen-on.
- **Record:** track any hike and export it as GPX.

There are no accounts. Saved trails, recordings and your live GPS position stay on the device; place searches, trail data, map tiles and elevation data are requested from third-party services (see the table below).

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (geometry, trail parsing, difficulty, GPX)
npm run build      # production build in dist/
```

GPS and offline need HTTPS (or localhost).

## Deploy

Each push to `main` builds and publishes to GitHub Pages through `.github/workflows/deploy.yml`.

One-time setup: in the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.

## Data sources and terms

| What | Source | Terms that matter |
|---|---|---|
| Map tiles | [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data) | Free, commercial use OK, attribution required. Offline downloads are allowed up to **3,000 tiles / 50 MB per area**, 4 parallel requests. The app enforces this. |
| Trails (Washington) | Hosted files built from the [Geofabrik](https://download.geofabrik.de) Washington extract by `scripts/build_trails.py` | Rebuilt on every deploy and every Monday. Served with the app, cached on the phone. |
| Trails (elsewhere) | Public [Overpass API](https://overpass-api.de) servers, with fallbacks | Shared and often busy. Extend the hosted data to more regions instead. |
| Elevation | [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) (Copernicus DEM GLO-90, 90 m) | The free tier is **non-commercial**. A commercial launch needs their API plan or a self-hosted copy. |
| Place search | OpenStreetMap Nominatim | At most 1 request per second, with no autocomplete. Swap it out before scaling. |

## How it works

- `scripts/build_trails.py` turns an OpenStreetMap extract into 0.25° grid-cell files (`trails/<x>_<y>.json` + `index.json`). The app loads only the cells for the area on screen; `src/lib/cells.ts` stitches routes that cross cells.

- `src/lib/trails.ts` handles the Overpass query. It joins OSM route relations and named paths into single lines and computes difficulty with the Shenandoah formula. Time estimates use Naismith's rule.
- `src/lib/offline.ts` prefetches tiles for zoom 10–14 around the trail, with a 1.5 km pad, into Cache Storage.
- `src/sw.ts` is the service worker. It serves saved tiles first and keys them without the weekly data version, so saved maps survive data updates.
- `src/screens/Navigate.tsx` snaps GPS fixes onto the route to compute distance, time and climb left. It adjusts the time to your actual pace after 400 m.

## Known limits (web app)

- **GPS stops when the screen locks**, especially on iPhone. Navigate and Record keep the screen awake. Background tracking needs a native wrapper.
- **iPhone may clear saved maps** for sites that aren't on the Home Screen. Installing the app avoids this, and the app prompts for it.
- The maps have **no contour lines or hillshade yet**. Adding them needs a terrain data source.
