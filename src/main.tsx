import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './redesign.css';
import { initSwUpdate } from './lib/swUpdate';

initSwUpdate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The map library is the heaviest part of the app and Find shows a map, so start fetching it now, in parallel with the first paint.
void import('./components/MapView');
