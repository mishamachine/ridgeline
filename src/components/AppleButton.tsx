import { useEffect, useRef } from 'react';
import { AppleButton as NativeAppleButton } from '../lib/native/appleButtonPlugin';
import { loadAppleScript, renderAppleButton } from '../lib/accounts/appleWeb';

export interface AppleButtonProps { platform: 'ios' | 'android' | 'web'; tone: 'light' | 'dark'; width: number; height: number; onClick: () => void }

/**
 * Sign in with Apple, drawn by Apple and never by us:
 *   iOS      the system button (ASAuthorizationAppleIDButton, type signIn) laid over a placeholder, through the local plugin (not device-tested)
 *   web      Apple's JS button (data-type "sign-in"), script loaded only now that this screen shows it; a click is handed to our own sign-in
 *   android  nothing (Android offers Google only)
 */
export function AppleButton({ platform, tone, width, height, onClick }: AppleButtonProps) {
  if (platform === 'android') return null;
  return platform === 'ios' ? <IosButton tone={tone} width={width} height={height} onClick={onClick} /> : <WebButton tone={tone} width={width} height={height} onClick={onClick} />;
}

type Inner = Omit<AppleButtonProps, 'platform'>;

function IosButton({ tone, width, height, onClick }: Inner) {
  const ref = useRef<HTMLDivElement>(null);
  const click = useRef(onClick); click.current = onClick;
  useEffect(() => {
    let off = false, raf = 0;
    const place = () => {
      raf = 0;
      const r = ref.current?.getBoundingClientRect();
      if (!r || off) return;
      NativeAppleButton.show({ x: r.left, y: r.top, width: r.width, height: r.height, dark: tone === 'dark' }).catch(() => {});
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(place); };
    place();
    window.addEventListener('resize', queue);
    document.addEventListener('scroll', queue, true);          // any scroll container moves the placeholder
    const tap = NativeAppleButton.addListener('tap', () => click.current());
    return () => {
      off = true; if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', queue); document.removeEventListener('scroll', queue, true);
      tap.then((h) => h.remove()).catch(() => {});
      NativeAppleButton.hide().catch(() => {});
    };
  }, [tone, width, height]);
  return <div ref={ref} aria-hidden="true" style={{ width, height }} />;
}

function WebButton({ tone, width, height, onClick }: Inner) {
  useEffect(() => { loadAppleScript().then(renderAppleButton).catch(() => {}); }, []);
  return (
    // A click is taken here, before Apple's own handler, and goes to our Supabase sign-in.
    <div style={{ width, height }} role="button" aria-label="Sign in with Apple" onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}>
      <div id="appleid-signin" data-color={tone === 'dark' ? 'white' : 'black'} data-border="true" data-type="sign-in" data-width={width} data-height={height} data-border-radius="4" />
    </div>
  );
}
