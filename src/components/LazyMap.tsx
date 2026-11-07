import { lazy, Suspense, type ComponentProps } from 'react';

// MapLibre is most of the app's weight: it loads when a map is first shown, not before the list.
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

export function LazyMap(props: ComponentProps<typeof MapView>) {
  return (
    <Suspense fallback={<div className="map" role="region" aria-label={props.label ?? 'Map'} aria-busy="true" />}>
      <MapView {...props} />
    </Suspense>
  );
}
