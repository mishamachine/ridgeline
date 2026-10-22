// Swiss Field Guide map style over OpenFreeMap (OpenMapTiles schema).
import type { StyleSpecification } from 'maplibre-gl';
import { GLYPHS_URL } from './tiles';

export const INK = '#111111';
export const RED = '#D52B26';
export const PAPER = '#F7F7F5';

const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function swissStyle(tileTemplate: string): StyleSpecification {
  const roadWidth = (min: number, max: number) =>
    ['interpolate', ['exponential', 1.5], ['zoom'], 10, min, 18, max] as unknown as number;
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      omt: { type: 'vector', tiles: [tileTemplate], minzoom: 0, maxzoom: 14, attribution: ATTRIBUTION },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PAPER } },
      { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'residential'], paint: { 'fill-color': '#EFEFEA' } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], paint: { 'fill-color': '#E2E8DA' } },
      { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'scrub', 'farmland']]], paint: { 'fill-color': '#EDF0E6' } },
      { id: 'ice', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'ice'], paint: { 'fill-color': '#FFFFFF' } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#DCE5D2', 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#CBDCE5' } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#8FAEBD', 'line-width': roadWidth(0.6, 3) } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#E2E2DC' } },
      {
        id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#C9C9C1', 'line-width': roadWidth(1.5, 16) },
      },
      {
        id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': roadWidth(0.8, 12) },
      },
      {
        id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        paint: { 'line-color': '#4A4A46', 'line-width': roadWidth(0.8, 2.5), 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'path-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 11 },
        paint: { 'text-color': '#4A4A46', 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
      },
      {
        id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 12 },
        paint: { 'text-color': '#3E6577', 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
      },
      {
        id: 'peak-dot', type: 'circle', source: 'omt', 'source-layer': 'mountain_peak', minzoom: 11,
        paint: { 'circle-radius': 3, 'circle-color': INK },
      },
      {
        id: 'peak-label', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', minzoom: 11,
        layout: {
          'text-field': ['case', ['has', 'ele'],
            ['concat', ['get', 'name'], '\n', ['to-string', ['round', ['*', ['get', 'ele'], 3.28084]]], ' ft'],
            ['get', 'name']],
          'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 0.6], 'text-anchor': 'top',
        },
        paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
      },
      {
        id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'hamlet']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['match', ['get', 'class'], ['city', 'town'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
          'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11],
        },
        paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
      },
    ],
  };
}
