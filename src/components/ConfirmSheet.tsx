import { useEffect, useRef } from 'react';

/** Keep Tab inside a dialog, close on Escape, and give focus back to what opened it. */
export function useDialogKeys(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('[data-autofocus], button, a[href]')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); opener?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

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
  const ref = useRef<HTMLDivElement>(null);
  useDialogKeys(ref, onCancel);
  return (
    <div className="sheet-wrap" onClick={onCancel}>
      <div ref={ref} className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="sheet-title" className="sheet-title">{title}</h2>
        {body && <p className="sheet-body">{body}</p>}
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        <button data-autofocus className="btn btn-outline" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  );
}
