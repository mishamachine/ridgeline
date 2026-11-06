import { useEffect, useState } from 'react';
import { onToast } from '../lib/toast';

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onToast(setMsg), []);
  return <div className="toast" role="status" aria-live="polite" hidden={!msg}>{msg}</div>;
}
