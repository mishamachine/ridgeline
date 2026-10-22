import { useEffect, useRef, useState } from 'react';
import { listActivities, deleteActivity, putActivity, Activity } from '../lib/store';
import { addFix, newActivity, trackDistance, downloadGPX, keepAwake } from '../lib/tracker';
import { duration, mi } from '../lib/format';

export function Record() {
  const [past, setPast] = useState<Activity[]>([]);
  const [current, setCurrent] = useState<Activity | null>(null);
  const [, force] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);
  const releaseRef = useRef<() => void>(() => {});

  const refresh = async () => setPast(await listActivities());
  useEffect(() => { refresh(); }, []);

  // Tick the clock while recording.
  useEffect(() => {
    if (!current) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [current]);

  async function start() {
    if (!navigator.geolocation) { setError('This device has no GPS access.'); return; }
    setError(null);
    const a = newActivity(`Hike ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
    setCurrent(a);
    releaseRef.current = await keepAwake();
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => { if (addFix(a, p)) force((n) => n + 1); },
      (e) => { if (e.code === e.PERMISSION_DENIED) setError('Location is blocked. Allow it in your browser settings.'); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }

  async function stop() {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    releaseRef.current();
    if (current) {
      current.endedAt = Date.now();
      if (current.points.length > 1) await putActivity(current);
    }
    setCurrent(null);
    refresh();
  }

  async function remove(id: string) {
    await deleteActivity(id);
    refresh();
  }

  const elapsed = (a: Activity) => ((a.endedAt ?? Date.now()) - a.startedAt) / 60000;

  return (
    <>
      <div className="top" style={{ borderBottom: '1px solid var(--ink)', paddingBottom: 16 }}>
        <h1>Record</h1>
        {current ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ font: '800 96px/0.9 var(--display)', letterSpacing: '-0.05em' }}>{mi(trackDistance(current.points))}</div>
            <div className="label">miles · {duration(elapsed(current))} · {current.points.length} GPS points</div>
          </div>
        ) : (
          <p className="meta" style={{ marginTop: 12 }}>Track any hike, on or off a mapped trail. Works without signal.</p>
        )}
      </div>
      {error && <p className="notice alert">{error}</p>}

      <div className="pad" style={{ flex: 1 }}>
        <h2 className="eyebrow" style={{ margin: '20px 0 4px' }}>Past hikes</h2>
        {past.map((a) => (
          <div key={a.id} className="row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
            <span>
              <span className="name" style={{ display: 'block' }}>{a.name}</span>
              <span className="meta">{mi(trackDistance(a.points))} mi · {duration(elapsed(a))} · {new Date(a.startedAt).toLocaleDateString('en-US')}</span>
            </span>
            <button className="text-btn" onClick={() => downloadGPX(a)}>GPX</button>
            <button className="text-btn danger" onClick={() => remove(a.id)} aria-label={`Delete ${a.name}`}>Delete</button>
          </div>
        ))}
        {past.length === 0 && <p className="empty" style={{ padding: '8px 0' }}>No hikes yet.</p>}
      </div>

      <div className="actions" style={{ gridTemplateColumns: '1fr' }}>
        {current
          ? <button className="action dark" onClick={stop}><span>Stop and save</span><small>Saved on this phone</small></button>
          : <button className="action primary" onClick={start}><span>Start recording</span><small>Keeps the screen on</small></button>}
      </div>
    </>
  );
}
