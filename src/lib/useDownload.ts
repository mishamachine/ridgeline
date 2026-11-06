import { useCallback, useEffect, useRef, useState } from 'react';
import { saveTrailOffline } from './offline';
import { bookmark } from './saved';
import type { Trail } from './trails';

/** Download a trail's map for offline use, with progress. Also bookmarks it. */
export function useDownload(trail: Trail, onDone: () => void) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(0);
    try {
      await saveTrailOffline(trail, (d, n) => setProgress(d / n), ac.signal);
      await bookmark(trail);
      onDone();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }, [trail, onDone]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  return { progress, error, start, cancel };
}
