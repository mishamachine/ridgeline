import { useEffect, useState } from 'react';
import { listSaved, SavedTrail } from '../lib/store';
import { removeTrailOffline, storageEstimate } from '../lib/offline';
import { TrailRow } from '../components/TrailRow';
import { mb } from '../lib/format';
import type { Trail } from '../lib/trails';

interface Props { visible: boolean; onOpen: (t: Trail) => void; onChange: () => void }

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export function Offline({ visible, onOpen, onChange }: Props) {
  const [saved, setSaved] = useState<SavedTrail[]>([]);
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);

  async function refresh() {
    setSaved(await listSaved());
    setStorage(await storageEstimate());
  }
  useEffect(() => { if (visible) refresh(); }, [visible]);

  async function remove(id: string) {
    await removeTrailOffline(id);
    await refresh();
    onChange();
  }

  const total = saved.reduce((s, x) => s + x.bytes, 0);

  return (
    <>
      <div className="top" style={{ borderBottom: '1px solid var(--ink)', paddingBottom: 16 }}>
        <h1>Offline</h1>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="num" style={{ fontSize: 48 }}>{saved.length}</span>
          <span className="meta">trail{saved.length === 1 ? '' : 's'} ready · {mb(total)} of maps</span>
        </div>
        {storage && storage.quota > 0 && (
          <>
            <div className="progress" style={{ marginTop: 10 }}><div style={{ width: `${Math.min(100, (storage.used / storage.quota) * 100)}%` }} /></div>
            <div className="meta" style={{ marginTop: 6 }}>{mb(storage.used)} used of {mb(storage.quota)} available on this device</div>
          </>
        )}
      </div>

      {!isStandalone() && (
        <p className="notice">
          {isIOS()
            ? 'Add Ridgeline to your Home Screen (Share → Add to Home Screen) so iPhone keeps your saved maps.'
            : 'Install Ridgeline from your browser menu so saved maps stay on this device.'}
        </p>
      )}

      <div className="pad">
        {saved.map((s) => (
          <div key={s.trail.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}><TrailRow trail={s.trail} onClick={() => onOpen(s.trail)} /></div>
            <button className="text-btn danger" onClick={() => remove(s.trail.id)} aria-label={`Remove ${s.trail.name}`}>Remove</button>
          </div>
        ))}
        {saved.length === 0 && (
          <p className="empty">Nothing saved yet. Open a trail and tap <b>Save offline</b> before you lose signal.</p>
        )}
      </div>
    </>
  );
}
