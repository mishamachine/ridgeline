# Ridgeline

Bold, simple trail maps that work offline. An installable web app (PWA) in the "Swiss Field Guide" style.

**Milestone 1, the core loop:**
- **Find:** trails from OpenStreetMap near you or any place you search.
- **Trail detail:** distance, climb, estimated time, difficulty and an elevation profile (hosted trail areas).
- **Save offline:** stores the route, profile and map for the trail's area on the phone.
- **Navigate:** live GPS with miles left, time left, climb ahead and an off-route alert. Also includes reverse direction and keep-screen-on.
- **Record:** track any hike and export it as GPX.

Everything stays on the device. There are no accounts.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (geometry, trail parsing, difficulty, GPX)
pip install -r scripts/requirements.txt   # Python 3.12; only for the trail build
python -m unittest discover -s scripts -p "test_*.py"   # elevation build tests (no network)
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
| Elevation | [Copernicus DEM GLO-90](https://registry.opendata.aws/copernicus-dem/) (90 m), sampled at **build time** by `scripts/elevation.py` from the public AWS bucket `copernicus-dem-90m` | Free of charge, **commercial use OK**, attribution required (see below). Nothing is fetched at run time. Trails found through Overpass outside the hosted area have no elevation. |
| Place search | OpenStreetMap Nominatim | At most 1 request per second, with no autocomplete. This is a separate open item from elevation: swap it out before scaling. |

### Elevation attribution (Copernicus DEM GLO-90)

Elevation is derived from the Copernicus WorldDEM-90 under its general-public licence (free of charge; reproduction, distribution and adaptation allowed). Because the app shows values computed from the DEM, the licence's notice for adapted data applies. It is shown under the elevation profile on every trail page, with these exact words:

> produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

and the licence's liability sentence:

> The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM™-90

The text lives in `src/lib/credits.ts`. Do not paraphrase it. The app must not suggest that it is endorsed by Copernicus, ESA, DLR or Airbus. Licence: [ESA/Copernicus data access licences (PDF), "Copernicus WorldDEM-90" section](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf). Dataset page: <https://registry.opendata.aws/copernicus-dem/>.

History: elevation used to be fetched at run time from the Open-Meteo API, whose free tier is non-commercial. That call was removed; the same Copernicus data is now sampled once per build.

## How it works

- `scripts/build_trails.py` turns an OpenStreetMap extract into 0.25° grid-cell files (`trails/<x>_<y>.json` + `index.json`). The app loads only the cells for the area on screen; `src/lib/cells.ts` stitches routes that cross cells.
- Each way in a cell file also carries `z`, its elevation in whole metres at every vertex, delta-encoded (`[z0, z1-z0, ...]`). `scripts/elevation.py` reads the needed 1° GLO-90 tiles (cached in `scripts/.dem-cache`, git-ignored) and takes the pixel under each vertex (nearest pixel). `src/lib/cells.ts` looks the heights up when it stitches a trail and `profileFromVertices` resamples them to the 100-point profile the screens use. The build **fails** if a tile that exists cannot be fetched or read; tiles absent from the bucket are open ocean and count as 0 m (the build also fails if more than 5% of points fall there).

- `src/lib/trails.ts` handles the Overpass query. It joins OSM route relations and named paths into single lines and computes difficulty with the Shenandoah formula. Time estimates use Naismith's rule.
- `src/lib/offline.ts` prefetches tiles for zoom 10–14 around the trail, with a 1.5 km pad, into Cache Storage.
- `src/sw.ts` is the service worker. It serves saved tiles first and keys them without the weekly data version, so saved maps survive data updates.
- `src/screens/Navigate.tsx` snaps GPS fixes onto the route to compute distance, time and climb left. It adjusts the time to your actual pace after 400 m.

## Known limits (web app)

- **GPS stops when the screen locks**, especially on iPhone. Navigate and Record keep the screen awake. Background tracking needs a native wrapper.
- **iPhone may clear saved maps** for sites that aren't on the Home Screen. Installing the app avoids this, and the app prompts for it.
- The maps have **no contour lines or hillshade yet**. Adding them needs a terrain data source.
