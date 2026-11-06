import { useEffect, useRef, useState } from 'react';
import './nav.css';
import { keepAwake } from '../../lib/tracker';
import { Glyph } from './Glyph';
import type { NavView } from './view';

export const HOLD_MS = 1000;

interface Props {
  view: NavView;
  trailName: string;
  voiceOn: boolean;
  toGo: string;
  pace: string;
  climb: string;
  pct: number | null;
  now: number;
  onExit: () => void;
}

/** Web stand-in for the lock-screen card: black, high contrast, screen kept on. Hold for a second to leave. */
export function PocketMode({ view, trailName, voiceOn, toGo, pace, climb, pct, now, onExit }: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  // Keep the screen on, and come back to it if the tab was hidden and returns.
  useEffect(() => {
    let release = () => {};
    let gone = false;
    const hold = () => keepAwake().then((r) => { if (gone) r(); else { release(); release = r; } });
    hold();
    const onVis = () => { if (document.visibilityState === 'visible') hold(); };
    document.addEventListener('visibilitychange', onVis);
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onVis);
      release();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const stop = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (timer.current != null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); onExit(); }, HOLD_MS);
  };
  useEffect(() => stop, []);

  const time = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="pocket" role="dialog" aria-label="Pocket mode"
      onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}>
      <div className="pocket-time">{time}</div>
      <div className="pocket-card">
        <div className="pocket-head"><span>Ridgeline · {trailName}</span><span>{voiceOn ? 'Voice on' : 'Voice off'}</span></div>
        <div className="pocket-main" role="status" aria-live="polite">
          <Glyph kind={view.glyph} size={64} dim="#555555" />
          <div>
            <div className="pocket-big">{view.big}</div>
            <div className="pocket-line">{view.line}</div>
            {view.sub && <div style={{ fontSize: 14, color: '#BDBDBD', marginTop: 2 }}>{view.sub}</div>}
          </div>
        </div>
        <div className="pocket-stats"><span><b>{toGo}</b> to go</span><span><b>{pace}</b></span><span><b>{climb}</b> climb</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="pocket-bar"><div style={{ width: `${Math.round((pct ?? 0) * 100)}%` }} /></div>
          <span style={{ fontSize: 13, color: '#BDBDBD' }}>{pct != null ? `${Math.round(pct * 100)}% done` : '—'}</span>
        </div>
      </div>
      <p className="pocket-foot">Keep Ridgeline open; your screen stays on in pocket mode.{voiceOn ? ' Voice directions keep playing.' : ''}</p>
      <button className={`pocket-exit${holding ? ' holding' : ''}`}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') stop(); }}
        onBlur={stop}>
        <i /><span>Hold 1 second to exit</span>
      </button>
    </div>
  );
}
