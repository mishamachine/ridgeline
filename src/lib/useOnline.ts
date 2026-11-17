import { useEffect, useState } from 'react';

/** Whether the device reports a connection; follows the browser's online and offline events. */
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const net = () => setOnline(navigator.onLine);
    window.addEventListener('online', net); window.addEventListener('offline', net);
    return () => { window.removeEventListener('online', net); window.removeEventListener('offline', net); };
  }, []);
  return online;
}
