import { createRoot } from 'react-dom/client';
import './styles.css';
import { Navigate } from './screens/Navigate';
import { Frame } from './lib/gps/frame';
import { cumulative } from './lib/geo';
import type { Trail } from './lib/trails';

const fr = new Frame([-121.7, 47.5]);
const P = (x: number, y: number) => fr.toLngLat(x, y);
const coords = [P(0, 0), P(400, 0), P(800, 60), P(1400, 60), P(1400, 300), P(800, 300)];
const trail: Trail = { id: 'h', name: 'Rattlesnake Ledge Trail', coords, lengthM: cumulative(coords).at(-1)!, loop: false, partial: false, osmUrl: '', tags: {},
  highlights: ['lake'], junctions: [{ along: 700, branches: [{ name: 'Old Quarry Path', point: P(430 + 300 + 15, 40) }] }] };
const w = window as any;
w.__said = [];
const synth = window.speechSynthesis;
const orig = synth.speak.bind(synth);
synth.speak = (u: SpeechSynthesisUtterance) => { w.__said.push(u.text); orig(u); };
let cb: any; let t = Date.now();
w.__fr = fr;
w.__fix = (x: number, y: number, acc = 5) => { t += 1000; const p = fr.toLngLat(x, y); cb?.({ coords: { latitude: p[1], longitude: p[0], accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: t }); };
Object.defineProperty(navigator, 'geolocation', { value: { watchPosition: (ok: any) => { cb = ok; return 1; }, clearWatch() {}, getCurrentPosition() {} }, configurable: true });
createRoot(document.getElementById('root')!).render(<Navigate tpl="" trail={trail} saved={true} onEnd={() => console.log('end')} onFinish={(s) => { w.__summary = s; console.log('finish', JSON.stringify({ ...s, trail: undefined, activity: undefined })); }} />);
