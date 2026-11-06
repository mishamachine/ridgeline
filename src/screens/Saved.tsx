import { useEffect, useState } from 'react';
import { TrailCard } from '../components/TrailCard';
import { Placeholder } from '../components/Bobo';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { DownloadIcon, ShareIcon } from '../components/NavIcons';
import { listAllSaved, unsave, type SavedItem } from '../lib/saved';
import { storageEstimate } from '../lib/offline';
import { useDownload } from '../lib/useDownload';
import { shareShortlist } from '../lib/share';
import { A2HS_TIP, isIOS, isStandalone } from '../lib/pwa';
import { mb } from '../lib/format';
import type { Trail } from '../lib/trails';

interface Props { visible: boolean; version: number; onOpen: (t: Trail) => void; onChange: () => void; onFind: () => void }

function Download({ trail, onDone }: { trail: Trail; onDone: () => void }) {
  const dl = useDownload(trail, onDone);
  return (
    <>
      <span className="fine">{dl.progress != null ? `Downloading ${Math.round(dl.progress * 100)}%` : 'Not offline'}</span>
      {dl.progress != null
        ? <button className="btn btn-outline btn-sm" onClick={dl.cancel}>Cancel</button>
        : <button className="btn btn-outline btn-sm" onClick={dl.start}><DownloadIcon size={18} /> Download</button>}
      {dl.error && <span className="fine" role="alert">{dl.error}</span>}
    </>
  );
}

export function Saved({ visible, version, onOpen, onChange, onFind }: Props) {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);
  const [removing, setRemoving] = useState<SavedItem | null>(null);

  async function refresh() {
    setItems(await listAllSaved());
    setStorage(await storageEstimate());
  }
  useEffect(() => { if (visible) refresh(); }, [visible, version]);

  async function remove() {
    if (!removing) return;
    await unsave(removing.trail.id);
    setRemoving(null);
    await refresh();
    onChange();
  }

  const offline = items?.filter((i) => i.offline).length ?? 0;
  const total = items?.reduce((s, x) => s + x.bytes, 0) ?? 0;

  return (
    <div className="page">
      <div className="page-head"><h1 className="page-title">Saved</h1></div>

      {items && items.length > 0 && (
        <div className="share-panel">
          <div className="share-title">Pick one with friends</div>
          <div className="share-body">Send your list as a link. They see it in the browser, no app or account needed. It’s read-only: voting isn’t in yet.</div>
          <button className="btn btn-primary" onClick={() => shareShortlist(items.map((i) => i.trail))}><ShareIcon size={20} /> Share list</button>
        </div>
      )}

      <div className="page-list">
        {items === null && <Placeholder title="Loading…" />}
        {items?.length === 0 && (
          <Placeholder title="Nothing saved yet">
            Tap the bookmark on a trail to keep it here. Download a trail’s map before you lose signal.
            <button className="btn btn-primary" onClick={onFind}>Find a trail</button>
          </Placeholder>
        )}
        {items?.map((i) => (
          <div key={i.trail.id} className="saved-item">
            <TrailCard trail={i.trail} saved offline={i.offline} onOpen={onOpen} onToggleSave={() => setRemoving(i)}
              extra={!i.offline ? <Download trail={i.trail} onDone={() => { refresh(); onChange(); }} /> : undefined} />
          </div>
        ))}
        {items && items.length > 0 && (
          <p className="fine">
            {offline} of {items.length} ready offline · {mb(total)} of maps
            {storage && storage.quota > 0 ? ` · ${mb(storage.used)} used of ${mb(storage.quota)} on this device` : ''}.
            Download the night before: ready-offline trails work with no signal.
          </p>
        )}
        {items && items.length > 0 && !isStandalone() && (
          <p className="note">{isIOS() ? A2HS_TIP : 'Install Ridgeline from your browser menu so saved maps stay on this device.'}</p>
        )}
      </div>

      {removing && (
        <ConfirmSheet title={`Remove ${removing.trail.name}?`} body={removing.offline ? 'This also deletes its offline map.' : undefined}
          confirmLabel="Remove" cancelLabel="Keep it" danger onConfirm={remove} onCancel={() => setRemoving(null)} />
      )}
    </div>
  );
}
