import { useEffect, useState } from 'react';
import { onToast } from '../lib/toast';
import { applyUpdate, onUpdateReady } from '../lib/swUpdate';

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onToast(setMsg), []);
  const [update, setUpdate] = useState(false);
  useEffect(() => onUpdateReady(setUpdate), []);
  return (
    <>
      <div className="toast" role="status" aria-live="polite" hidden={!msg}>{msg}</div>
      <div className="toast update-toast" role="status" aria-live="polite" hidden={!update}>
        {update && <>Update ready <button type="button" onClick={applyUpdate}>Reload</button></>}
      </div>
    </>
  );
}
