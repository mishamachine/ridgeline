import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bottom sheet that asks before something hard to undo. The safe choice has focus. */
export function ConfirmSheet({ title, body, confirmLabel, cancelLabel = 'Keep going', danger, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div className="sheet-wrap" onClick={onCancel}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="sheet-title" className="sheet-title">{title}</h2>
        {body && <p className="sheet-body">{body}</p>}
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        <button ref={cancelRef} className="btn btn-outline" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  );
}
