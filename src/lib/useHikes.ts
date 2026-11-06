import { useCallback, useEffect, useState } from 'react';
import { Activity, listActivities, listSaved } from './store';
import type { BadgeTrail } from './badges';

/** Hikes and saved trails from this phone. Pass `preset` to skip loading (previews and tests). */
export function useHikes(preset?: { activities: Activity[]; trails: BadgeTrail[] }) {
  const [activities, setActivities] = useState<Activity[]>(preset?.activities ?? []);
  const [trails, setTrails] = useState<BadgeTrail[]>(preset?.trails ?? []);
  const [loaded, setLoaded] = useState(!!preset);

  const reload = useCallback(async () => {
    if (preset) return;
    try {
      const [a, s] = await Promise.all([listActivities(), listSaved()]);
      setActivities(a);
      setTrails(s.map((x) => x.trail));
    } catch { /* storage unavailable: show empty */ }
    setLoaded(true);
  }, [preset]);

  useEffect(() => { reload(); }, [reload]);
  return { activities, trails, loaded, reload };
}
