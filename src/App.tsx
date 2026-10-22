import { useCallback, useEffect, useState } from 'react';
import { getTileTemplate } from './lib/offline';
import { listSaved } from './lib/store';
import type { Trail } from './lib/trails';
import { Find } from './screens/Find';
import { Detail } from './screens/Detail';
import { Navigate } from './screens/Navigate';
import { Offline } from './screens/Offline';
import { Record } from './screens/Record';

export type Tab = 'find' | 'offline' | 'record';
type Overlay = { kind: 'detail'; trail: Trail } | { kind: 'nav'; trail: Trail } | null;

export function App() {
  const [tpl, setTpl] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('find');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const refreshSaved = useCallback(async () => {
    setSavedIds(new Set((await listSaved()).map((s) => s.trail.id)));
  }, []);

  useEffect(() => {
    getTileTemplate().then(setTpl);
    refreshSaved();
  }, [refreshSaved]);

  if (!tpl) return <div className="app"><p className="empty">Loading…</p></div>;

  const openTrail = (trail: Trail) => setOverlay({ kind: 'detail', trail });
  const showTabs = overlay?.kind !== 'nav';

  return (
    <div className="app">
      {/* Tabs stay mounted so the map, list and any recording keep their state. */}
      <div className="screen" hidden={!!overlay || tab !== 'find'}>
        <Find tpl={tpl} visible={!overlay && tab === 'find'} savedIds={savedIds} onOpen={openTrail} />
      </div>
      <div className="screen" hidden={!!overlay || tab !== 'offline'}>
        <Offline visible={!overlay && tab === 'offline'} onOpen={openTrail} onChange={refreshSaved} />
      </div>
      <div className="screen" hidden={!!overlay || tab !== 'record'}>
        <Record />
      </div>

      {overlay?.kind === 'detail' && (
        <div className="screen">
          <Detail
            key={overlay.trail.id}
            tpl={tpl}
            trail={overlay.trail}
            onBack={() => setOverlay(null)}
            onStart={(trail) => setOverlay({ kind: 'nav', trail })}
            onSavedChange={refreshSaved}
          />
        </div>
      )}
      {overlay?.kind === 'nav' && (
        <div className="screen">
          <Navigate tpl={tpl} trail={overlay.trail} saved={savedIds.has(overlay.trail.id)} onEnd={() => setOverlay({ kind: 'detail', trail: overlay.trail })} />
        </div>
      )}

      {showTabs && (
        <nav className="tabbar" aria-label="Main">
          {(['find', 'offline', 'record'] as Tab[]).map((t) => (
            <button key={t} className="tab" aria-current={!overlay && tab === t ? 'page' : undefined}
              onClick={() => { setOverlay(null); setTab(t); }}>
              {t === 'find' ? 'Find' : t === 'offline' ? 'Offline' : 'Record'}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
