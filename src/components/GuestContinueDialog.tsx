import { useRef } from 'react';
import { useAnnounceOverlay } from '../lib/overlayEvents';
import { guestNoteText } from '../lib/accounts/guestContinue';
import { useDialogKeys } from './ConfirmSheet';

/** The one-time note before a guest carries on without an account. Escape and "Got it" both close it. */
export function GuestContinueDialog({ platform, onClose }: { platform: 'ios' | 'android' | 'web'; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useAnnounceOverlay();
  useDialogKeys(ref, onClose);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby="gc-title" aria-describedby="gc-body" onClick={(e) => e.stopPropagation()}>
        <h2 id="gc-title" className="sheet-title">Continue without an account</h2>
        <p id="gc-body" className="sheet-body">{guestNoteText(platform)}</p>
        <button data-autofocus className="btn btn-primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
