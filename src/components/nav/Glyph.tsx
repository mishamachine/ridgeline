export type GlyphKind = 'stay-left' | 'stay-right' | 'turn-left' | 'turn-right' | 'straight' | 'uturn' | 'off' | 'wait';

const ARROW = { fill: 'none', strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Big direction glyph for the banner and pocket mode. White on dark. */
export function Glyph({ kind, size = 56, dim = '#6A6A6A' }: { kind: GlyphKind; size?: number; dim?: string }) {
  const flip = kind === 'stay-right' || kind === 'turn-right' ? 'translate(56 0) scale(-1 1)' : undefined;
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 56 56" stroke="#FFFFFF" {...ARROW} aria-hidden="true">
      <g transform={flip}>
        {(kind === 'stay-left' || kind === 'stay-right') && <><path d="M30 52V30" /><path d="M30 30L14 12" /><path d="M14 24V12h12" /><path d="M30 30l12-14" stroke={dim} /></>}
        {(kind === 'turn-left' || kind === 'turn-right') && <><path d="M36 52V32c0-9-6-16-15-16H14" /><path d="M22 8l-8 8 8 8" /></>}
        {kind === 'straight' && <><path d="M28 52V8" /><path d="M16 20L28 8l12 12" /></>}
        {kind === 'uturn' && <><path d="M14 50V22a12 12 0 0124 0v26" /><path d="M30 38l8 10 8-10" /></>}
        {kind === 'off' && <><path d="M28 8L51 49H5z" /><path d="M28 22v12" /><path d="M28 41v1" /></>}
        {kind === 'wait' && <><circle cx="28" cy="28" r="18" strokeDasharray="4 8" /></>}
      </g>
    </svg>
  );
}

export const VoiceIcon = ({ on }: { on: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9z" />
    {on ? <path d="M16 9a4 4 0 010 6" /> : <path d="M17 9l5 6M22 9l-5 6" />}
  </svg>
);
