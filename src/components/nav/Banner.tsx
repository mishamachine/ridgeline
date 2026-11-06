import './nav.css';
import { Glyph, VoiceIcon } from './Glyph';
import type { NavView } from './view';

interface Props { view: NavView; voiceOn: boolean; onVoice: () => void; /** Shown while off the trail: centre on the way back. */ onBack?: () => void; /** "Heading back? Switch directions": does nothing until tapped. */ onSwitch?: () => void }

export function Banner({ view, voiceOn, onVoice, onBack, onSwitch }: Props) {
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
    {onSwitch && !onBack && <button className="nv-switch" onClick={onSwitch}>Heading back? Switch directions</button>}
    {onBack && <button className="nv-back" onClick={onBack}>Take me back to the trail</button>}
    </>
  );
}
