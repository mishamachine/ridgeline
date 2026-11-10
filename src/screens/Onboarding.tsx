import { useAnnounceOverlay } from '../lib/overlayEvents';
import { useEffect, useRef, useState } from 'react';
import { features } from '../lib/features';
import { updateSettings } from '../lib/settings';
import findArt from '../assets/onboard-find.svg';
import offlineArt from '../assets/onboard-offline.svg';
import voiceArt from '../assets/onboard-voice.svg';
import badgesArt from '../assets/onboard-badges.svg';
import boboUrl from '../assets/trail-bobo.svg';
import './profile.css';

export interface Card { id: 'find' | 'offline' | 'forks' | 'badges' | 'location'; tag: string; title: string; body: string; art: string; alt: string }

/** Copy is driven by `features`, so a card never promises something this build cannot do. */
export function onboardingCards(f: { voice: boolean; screenOff: boolean; badges: boolean }, withLocation: boolean): Card[] {
  const forks = f.voice && f.screenOff
    ? 'Short spoken directions at the forks, even with your phone in your pocket and the screen off.'
    : f.voice
      ? 'Short spoken directions at the forks. Keep your phone in your pocket; Ridgeline keeps the screen on while you hike.'
      : 'Ridgeline buzzes if you go off route and keeps the screen on while you hike.';
  const cards: Card[] = [
    { id: 'find', tag: 'Find', title: 'Great hikes, minutes away', body: 'Find trails near you. See the length, the climb and the time before you go.', art: findArt, alt: 'A map with trail pins' },
    { id: 'offline', tag: 'Offline', title: 'Works with no signal', body: 'Tap Save offline the night before. The map and route live on your phone.', art: offlineArt, alt: 'A phone with a saved map' },
    { id: 'forks', tag: f.voice ? 'Voice' : 'Directions', title: f.voice ? 'Bobo talks you through the forks' : 'Keep your eyes on the trail', body: forks, art: voiceArt, alt: 'Bobo at a fork in the trail' },
  ];
  if (f.badges) cards.push({ id: 'badges', tag: 'Badges', title: 'Collect badges, share Ridgeline', body: 'Earn badges for classics, early starts and more. They stay on your phone. Share Ridgeline with a friend any time from Profile.', art: badgesArt, alt: 'Badges on a trail' });
  if (withLocation) cards.push({ id: 'location', tag: 'Location', title: 'Let Ridgeline find you?', body: 'Your location makes Ridgeline work on the trail. It stops when you finish.', art: boboUrl, alt: 'Bobo with a bandana' });
  return cards;
}

const PERKS = ['Centre the map on you when you open it or tap Locate', 'Your precise location while you navigate or record a hike', 'Stays on your phone. Never sent to our servers.'];

/**
 * First-run tour. `replay` hides the location card (replayed from Profile).
 * The OS location prompt appears only after "Allow location".
 */
export function Onboarding({ onDone, replay = false }: { onDone: () => void; replay?: boolean }) {
  useAnnounceOverlay();   // the tour covers the app: the native Apple button must not float over it
  const cards = onboardingCards(features, !replay);
  const [i, setI] = useState(0);
  const [asking, setAsking] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const touchX = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const card = cards[i];
  const last = i === cards.length - 1;

  const finish = () => { updateSettings({ onboardingSeen: true }); onDone(); };
  const go = (n: number) => setI(Math.max(0, Math.min(cards.length - 1, n)));
  const step = (d: number) => setI((n) => Math.max(0, Math.min(cards.length - 1, n + d)));

  useEffect(() => { head.current?.focus(); }, [i]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'Tab' && box.current) {
        // Keep focus inside the tour while it is open.
        const items = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="-1"]')];
        const first = items[0], lastEl = items[items.length - 1];
        const active = document.activeElement;
        if (!box.current.contains(active)) { e.preventDefault(); first?.focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); lastEl?.focus(); }
        else if (!e.shiftKey && active === lastEl) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function allow() {
    if (!navigator.geolocation) { finish(); return; }
    setAsking(true);
    // One-shot: only to show the OS prompt. The position is not stored or used.
    navigator.geolocation.getCurrentPosition(finish, finish, { timeout: 15000, maximumAge: Infinity });
  }

  function skip() {
    const loc = cards.findIndex((c) => c.id === 'location');
    if (loc > i) go(loc); else finish();
  }

  return (
    <div
      ref={box}
      className="ob"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Ridgeline"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
      }}
    >
      <div className="ob-top">
        <div className="ob-prog" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={cards.length} aria-valuenow={i + 1} aria-valuetext={`Step ${i + 1} of ${cards.length}`}>
          {cards.map((c, k) => <i key={c.id} className={k <= i ? 'on' : ''} />)}
        </div>
        {!(last && !replay) && <button className="ob-skip" onClick={skip}>Skip</button>}
      </div>

      <div className="ob-art"><img src={card.art} alt={card.alt} /><span className="ob-tag">{card.tag}</span></div>

      <div aria-live="polite">
        <h1 ref={head} tabIndex={-1}>{card.title}</h1>
        <p>{card.body}</p>
      </div>

      {card.id === 'location' && <ul>{PERKS.map((p) => <li key={p}>{p}</li>)}</ul>}

      <div className="ob-foot">
        {card.id === 'location' ? (
          <>
            <button className="ob-primary" onClick={allow} disabled={asking}>{asking ? 'Waiting for your phone…' : 'Allow location'}</button>
            <button className="ob-quiet" onClick={finish} disabled={asking}>Not now</button>
          </>
        ) : (
          <>
            <button className="ob-primary" onClick={() => (last ? finish() : go(i + 1))}>{last ? 'Done' : 'Next'}</button>
            {i > 0 && <button className="ob-quiet" onClick={() => go(i - 1)}>Back</button>}
          </>
        )}
      </div>
    </div>
  );
}
