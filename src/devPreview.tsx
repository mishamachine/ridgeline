// Dev harness (not imported by main.tsx, so it is not in the app build).
// Use: in a local, uncommitted main.tsx, `import { DevPreview, previewScreen } from './devPreview'` and render
// <DevPreview /> when previewScreen() is set. Then open /?screen=profile | badges | onboarding | onboarding-replay (&press=N for later cards).
import { useEffect, useState } from 'react';
import type { Activity } from './lib/store';
import type { BadgeTrail } from './lib/badges';
import type { LngLat } from './lib/geo';
import { Profile } from './screens/Profile';
import { Badges } from './screens/Badges';
import { Onboarding } from './screens/Onboarding';

export const previewScreen = () => new URLSearchParams(location.search).get('screen');

const line = (lon: number, lat0: number, km: number, n = 31): LngLat[] => Array.from({ length: n }, (_, k) => [lon, lat0 + (km / 111.19) * (k / (n - 1))]);
const mk = (id: string, name: string, lon: number, highlights: string[], ascentM: number): BadgeTrail => ({ id, name, coords: line(lon, 47.43, 3.2), ascentM, highlights });

export const sampleTrails: BadgeTrail[] = [
  mk('t1', 'Rattlesnake Ledge', -121.77, ['views', 'lake'], 370),
  mk('t2', 'Lake 22', -121.75, ['lake'], 480),
  mk('t3', 'Mount Si', -121.73, ['views'], 970),
];

const at = (id: string, tr: BadgeTrail, d: Date, extra: Partial<Activity> = {}): Activity => ({
  id, name: tr.name, trailId: tr.id, startedAt: d.getTime(), endedAt: d.getTime() + 2.5 * 3600_000, ...extra,
  points: tr.coords.map(([lon, lat], k) => ({ lon, lat, alt: 200 + k * 12, acc: 8, t: d.getTime() + k * 240_000 })),
});

export const sampleActivities: Activity[] = [
  at('a1', sampleTrails[0], new Date(2026, 9, 12, 6, 40), { withDog: true }),
  at('a2', sampleTrails[1], new Date(2026, 9, 25, 9, 15)),
  at('a3', sampleTrails[2], new Date(2026, 10, 1, 8, 5), { rain: true }),
];

let pressed = false; // StrictMode runs effects twice in dev

export function DevPreview() {
  const [screen, setScreen] = useState(previewScreen() ?? 'profile');
  // ?press=N sends N ArrowRight presses, to capture later onboarding cards.
  useEffect(() => {
    if (pressed) return;
    pressed = true;
    const n = Number(new URLSearchParams(location.search).get('press') ?? 0);
    for (let k = 0; k < n; k++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  }, []);
  const preset = { activities: sampleActivities, trails: sampleTrails };
  return (
    <div className="app">
      {screen === 'badges' && <Badges onBack={() => setScreen('profile')} preset={preset} />}
      {screen === 'profile' && <Profile preset={preset} onOpenBadges={() => setScreen('badges')} onReplayTour={() => setScreen('onboarding-replay')} />}
      {screen === 'onboarding' && <Onboarding onDone={() => setScreen('profile')} />}
      {screen === 'onboarding-replay' && <Onboarding replay onDone={() => setScreen('profile')} />}
    </div>
  );
}
