import { useEffect, useRef, useState } from 'react';
import { Activity, deleteActivity, listSaved, patchActivity } from '../lib/store';
import { BadgeTrail, computeBadges, hikeTotals, nextBadge } from '../lib/badges';
import { useHikes } from '../lib/useHikes';
import { useSettings } from '../lib/settings';
import { climbUnit, climbValue, distanceUnit, distanceValue } from '../lib/units';
import { duration, mb } from '../lib/format';
import { downloadGPX, trackDistance } from '../lib/tracker';
import { removeTrailOffline, storageEstimate } from '../lib/offline';
import { Backup, MAX_BACKUP_BYTES, downloadBackup, exportBackup, parseBackup, restoreBackup } from '../lib/backup';
import { ELEVATION_NOTICE } from '../lib/credits';
import { shareApp } from '../lib/share';
import { features } from '../lib/features';
import { ChevronIcon } from '../components/Icons';
import { PageHead } from '../components/PageHead';
import { BadgeMedal } from './Badges';
import './profile.css';

const base = import.meta.env.BASE_URL ?? '/';

export interface ProfileProps {
  onOpenBadges: () => void;
  onReplayTour: () => void;
  onOpenActivity?: (a: Activity) => void;
  /** Changes when the screen should re-read the phone (a hike just finished, or the tab was opened). */
  version?: number;
  /** Previews and tests only: skip reading the phone. */
  preset?: { activities: Activity[]; trails: BadgeTrail[] };
}

const trailCount = (b: Backup) => new Set([...b.saved.map((x) => x.trail.id), ...b.shortlist.map((x) => x.trail.id)]).size;

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className="pf-switchbox" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="pf-switch" aria-hidden="true" data-on={on} />
    </button>
  );
}

export function Profile({ onOpenBadges, onReplayTour, onOpenActivity, version, preset }: ProfileProps) {
  const { activities, trails, reload } = useHikes(preset);
  const [settings, setSettings] = useSettings();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, setPending] = useState<Backup | null>(null);
  const [status, setStatus] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshStorage = async () => {
    try { setStorage(await storageEstimate()); setSavedCount((await listSaved()).length); } catch { /* unsupported */ }
  };
  useEffect(() => { if (!preset) refreshStorage(); }, [preset]);
  useEffect(() => { if (version) reload(); }, [version, reload]);

  const u = settings.units;
  const totals = hikeTotals(activities, trails);
  const badges = computeBadges(activities, trails);
  const next = nextBadge(badges);
  const earned = badges.filter((b) => b.earned).length;
  const recorded = activities.filter((a) => a.points.length >= 2);
  const first = recorded.length ? new Date(Math.min(...recorded.map((a) => a.startedAt))) : null;

  async function remove(id: string) {
    await deleteActivity(id);
    setConfirmDelete(null);
    reload();
  }

  async function mark(a: Activity, key: 'withDog' | 'rain') {
    await patchActivity(a.id, { [key]: !a[key] });
    reload();
  }

  async function clearOffline() {
    for (const s of await listSaved()) await removeTrailOffline(s.trail.id);
    setConfirmClear(false);
    refreshStorage();
  }

  async function backUp() {
    try { downloadBackup(await exportBackup()); setStatus('Backup file saved. Keep it somewhere safe; it holds your hikes.'); }
    catch { setStatus('Could not make a backup on this device.'); }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) {
      if (fileRef.current) fileRef.current.value = '';
      setPending(null);
      setStatus('This file is too large to be a Ridgeline backup (over 20 MB).');
      return;
    }
    const r = parseBackup(await f.text());
    if (fileRef.current) fileRef.current.value = '';
    if (!r.ok) { setPending(null); setStatus(r.error); return; }
    setStatus('');
    setPending(r.backup);
  }

  async function doRestore() {
    if (!pending) return;
    const progress = { done: 0, total: 0 };
    try {
      await restoreBackup(pending, progress);
      const trails = trailCount(pending);
      setStatus(`Restored ${pending.activities.length} hikes and ${trails} saved ${trails === 1 ? 'trail' : 'trails'}.${pending.saved.length ? ' Open a trail and tap Save offline to download its map again.' : ''}`);
    } catch { setStatus(`Restore stopped partway: ${progress.done} of ${progress.total} items were written. Nothing on your phone was deleted. Try again; items already restored are simply replaced.`); }
    setPending(null);
    reload();
    refreshStorage();
  }

  return (
    <div className="screen pf">
      <PageHead title="Profile" byline sub={first ? `Hiking since ${first.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} · with Bobo` : 'Record a hike and it shows up here'} />

      <ul className="pf-totals" aria-label="Your totals">
        <li className="pf-total dark"><b>{totals.hikes}</b><span>{totals.hikes === 1 ? 'hike' : 'hikes'}</span></li>
        <li className="pf-total"><b>{distanceValue(totals.distanceM, u)}</b><span>{distanceUnit(u) === 'mi' ? 'miles' : 'km'}</span></li>
        <li className="pf-total"><b>{climbValue(totals.climbM, u)}</b><span>{climbUnit(u)} climbed</span></li>
      </ul>

      <div className="pf-body">
        {features.badges && (
          <button className="pf-card" onClick={onOpenBadges}>
            <span className="pf-medals" aria-hidden="true">{[...badges].sort((a, b) => Number(b.earned) - Number(a.earned)).slice(0, 3).map((b) => <i key={b.id} data-on={b.earned}><BadgeMedal id={b.id} size={18} /></i>)}</span>
            <span>
              <b>Badges · {earned} of {badges.length}</b>
              <small>{next ? `Next: ${next.name} (${next.progress.have} of ${next.progress.need}${next.id === '10k-club' ? ' ft' : ''})` : 'All earned'}</small>
            </span>
            <ChevronIcon size={18} />
          </button>
        )}

        <h2 className="pf-h">Hike history</h2>
        <div className="pf-group">
          {recorded.length === 0 && <p className="pf-empty">No hikes yet. Start one from a trail and it is saved here, on your phone.</p>}
          {recorded.map((a) => {
            const canOpen = !!onOpenActivity && !!a.trailId;
            const info = (
              <>
                <b>{a.name}</b>
                <small>{distanceValue(trackDistance(a.points), u)} {distanceUnit(u)} · {duration(((a.endedAt ?? a.startedAt) - a.startedAt) / 60000)} · {new Date(a.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small>
              </>
            );
            return (
              <div key={a.id} className="pf-hike">
                <div className="pf-hike-row">
                  {canOpen ? <button className="pf-hike-main" onClick={() => onOpenActivity!(a)} aria-label={`Open ${a.name}`}>{info}</button> : <div className="pf-hike-main">{info}</div>}
                  <button className="pf-ico" aria-pressed={!!a.withDog} aria-label="With my dog" title="With my dog" onClick={() => mark(a, 'withDog')}><BadgeMedal id="trail-buddy" size={20} /></button>
                  <button className="pf-ico" aria-pressed={!!a.rain} aria-label="In the rain" title="In the rain" onClick={() => mark(a, 'rain')}><BadgeMedal id="rain-or-shine" size={20} /></button>
                  <button className="pf-ico" aria-label={`More for ${a.name}`} aria-haspopup="menu" aria-expanded={menu === a.id} onClick={() => setMenu(menu === a.id ? null : a.id)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                  </button>
                </div>
                {menu === a.id && (
                  <div className="pf-menu" role="menu">
                    <button role="menuitem" className="pf-btn" onClick={() => { downloadGPX(a); setMenu(null); }}>Export as GPX</button>
                    <button role="menuitem" className="pf-btn danger" onClick={() => { setMenu(null); setConfirmDelete(a.id); }}>Delete hike</button>
                  </div>
                )}
                {confirmDelete === a.id && (
                  <div className="pf-confirm" role="alertdialog" aria-label={`Delete ${a.name}?`}>
                    <p>Delete this hike from your phone? This cannot be undone.</p>
                    <div className="pf-actions" style={{ padding: 0 }}>
                      <button className="pf-btn danger" onClick={() => remove(a.id)}>Delete hike</button>
                      <button className="pf-btn" onClick={() => setConfirmDelete(null)}>Keep it</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <h2 className="pf-h">Settings</h2>
        <div className="pf-group">
          <div className="pf-row pf-static" aria-label="Account: not signed in, optional">
            <span>Account</span><span className="val">Not signed in · optional</span>
          </div>
          <p className="pf-note pf-static" style={{ margin: 0, paddingTop: 8 }}>Ridgeline works without an account. Optional sign-in may come later; nothing to do now.</p>

          <div className="pf-row">
            <span>Voice directions</span>
            <Switch on={settings.voice} onChange={(v) => setSettings({ voice: v })} label="Voice directions" />
          </div>
          <p className="pf-note" style={{ margin: 0 }}>
            {features.voice ? 'Short spoken directions at the forks, using a voice already on your phone.' : 'Spoken directions are coming in a later update; your choice is saved.'} Directions are a guide; check conditions; not for emergency use.
          </p>

          <div className="pf-row">
            <span>Units</span>
            <div className="pf-seg" role="group" aria-label="Units">
              <button aria-pressed={u === 'imperial'} onClick={() => setSettings({ units: 'imperial' })}>Miles, ft</button>
              <button aria-pressed={u === 'metric'} onClick={() => setSettings({ units: 'metric' })}>Km, m</button>
            </div>
          </div>

          <div className="pf-row">
            <span>New hikes start “with my dog”</span>
            <Switch on={settings.withDogDefault} onChange={(v) => setSettings({ withDogDefault: v })} label="New hikes start with my dog" />
          </div>

          <div className="pf-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
            <span>Offline maps</span>
            <span className="val" style={{ textAlign: 'left' }}>
              {savedCount} {savedCount === 1 ? 'trail' : 'trails'} saved{storage ? ` · this app uses ${mb(storage.used)} of ${mb(storage.quota)} available` : ''}
            </span>
            <button className="pf-btn danger" disabled={savedCount === 0} onClick={() => setConfirmClear(true)}>Clear offline maps</button>
          </div>
          {confirmClear && (
            <div className="pf-confirm" role="alertdialog" aria-label="Clear offline maps?">
              <p>Remove all saved trails and their offline maps from this phone? You can save them again with a signal.</p>
              <div className="pf-actions" style={{ padding: 0 }}>
                <button className="pf-btn danger" onClick={clearOffline}>Clear maps</button>
                <button className="pf-btn" onClick={() => setConfirmClear(false)}>Keep them</button>
              </div>
            </div>
          )}

          <details className="pf-row" style={{ display: 'block', padding: 0 }}>
            <summary className="pf-row" style={{ borderBottom: 0, cursor: 'pointer', listStyle: 'none' }}><span>Location &amp; privacy</span><span className="val">Stays on your phone</span></summary>
            <div className="pf-credits">
              <p>Ridgeline uses your location to centre the map when you open it or tap Locate, and your precise location while you navigate or record a hike. It stops when you finish. In the web version, location stops when your screen locks, so Ridgeline keeps the screen on. Your location is never sent to our servers.</p>
              <a className="pf-link" href={`${base}privacy/`}>Read the privacy policy</a>
            </div>
          </details>

          <a className="pf-row" href={`${base}support/`}><span>Help &amp; support</span><ChevronIcon size={16} /></a>
          <button className="pf-row" onClick={onReplayTour}><span>Replay the tour</span><ChevronIcon size={16} /></button>

          <details className="pf-row" style={{ display: 'block', padding: 0 }}>
            <summary className="pf-row" style={{ borderBottom: 0, cursor: 'pointer', listStyle: 'none' }}><span>Credits</span></summary>
            <div className="pf-credits">
              <p>Trails and map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, available under the Open Database Licence (ODbL).</p>
              <p>Map tiles by <a href="https://openfreemap.org">OpenFreeMap</a>.</p>
              <p>Elevation {ELEVATION_NOTICE}.</p>
            </div>
          </details>
        </div>

        <h2 className="pf-h">Back up &amp; restore</h2>
        <div className="pf-group">
          <p className="pf-note" style={{ paddingTop: 12 }}>Save your hikes, saved trails and settings to a file, and load them back on this or another phone. No account needed. Offline map files are not included; save those trails offline again.</p>
          <div className="pf-actions">
            <button className="pf-btn solid" onClick={backUp}>Back up to a file</button>
            <button className="pf-btn" onClick={() => fileRef.current?.click()}>Restore from a file</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Choose a Ridgeline backup file" />
          </div>
          {pending && (
            <div className="pf-confirm" role="alertdialog" aria-label="Restore this backup?">
              <p>This backup has {pending.activities.length} {pending.activities.length === 1 ? 'hike' : 'hikes'} and {trailCount(pending)} saved {trailCount(pending) === 1 ? 'trail' : 'trails'}. Restoring replaces hikes on this phone that have the same ID, and your current settings. Nothing else is removed.</p>
              <div className="pf-actions" style={{ padding: 0 }}>
                <button className="pf-btn solid" onClick={doRestore}>Restore</button>
                <button className="pf-btn" onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          )}
          {status && <p className="pf-status" role="status">{status}</p>}
        </div>

        <div className="pf-center">
          <button className="pf-link" onClick={shareApp}>Share Ridgeline with friends</button>
        </div>
      </div>
    </div>
  );
}
