// Hosted trail data: small grid-cell files built from OpenStreetMap (scripts/build_trails.py).
import type { BBox } from './geo';
import { parseOverpass, profileFromVertices, withElevation, type Trail } from './trails';
import { SITE_URL, SITE_URL_FALLBACK } from './site';
import { isNative } from './native/platform';
