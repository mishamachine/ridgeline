import { km, mi } from './format';
import { METRIC_COPY } from './metricCopy';
import type { Units } from './settings';

/** Record screen distance: the big number, its label ("miles" / "km") and the past-hike row text. No climb is shown on this screen. */
export function recordDistance(m: number, units: Units = 'imperial') {
  return units === 'metric'
    ? { value: km(m), big: METRIC_COPY.recordUnit, row: `${km(m)} ${METRIC_COPY.recordUnit}` }
    : { value: mi(m), big: 'miles', row: `${mi(m)} mi` };
}
