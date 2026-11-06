import './nav.css';
import { Glyph, VoiceIcon } from './Glyph';
import type { NavView } from './view';

interface Props { view: NavView; voiceOn: boolean; onVoice: () => void; /** Shown while off the trail: centre on the way back. */ onBack?: () => void }

export function Banner({ view, voiceOn, onVoice, onBack }: Props) {
  return (
    <>
    <div className={`nv-banner${view.off ? ' off' : ''}`} role="status" aria-live="polite">
      <Glyph kind={view.glyph} />
      <div className="nv-text">
        <div className="nv-big">{view.big}</div>
        <div className="nv-line">{view.line}</div>
        {view.sub && <div className="nv-sub">{view.sub}</div>}
      </div>
      <button className="nv-voice" aria-pressed={voiceOn} aria-label="Voice directions" title={voiceOn ? 'Voice on' : 'Voice off'} onClick={onVoice}><VoiceIcon on={voiceOn} /></button>
    </div>
    {onBack && <button className="nv-back" onClick={onBack}>Take me back to the trail</button>}
    </>
  );
}
