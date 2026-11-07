import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './redesign.css';
import { addProtocol } from 'maplibre-gl';
import { isNative } from './lib/native/platform';
import { nativeSpeaker } from './lib/native/speech';
import { setSpeaker } from './lib/voice/speak';
import { PROTOCOL, loadMapResource, probeCacheStorage } from './lib/native/offlineMaps';

if (isNative()) {
  setSpeaker(nativeSpeaker()); // spoken directions keep going with the screen off
  addProtocol(PROTOCOL, async (p) => ({ data: await loadMapResource(p.url) })); // saved maps without a service worker
  void probeCacheStorage().then((r) => console.log(`[cache-probe] ${r}`));
}
import { initSwUpdate } from './lib/swUpdate';

if (!isNative()) initSwUpdate(); // the apps have no service worker

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
