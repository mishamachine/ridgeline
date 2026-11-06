// The one place that talks. The native app swaps in its own text-to-speech with setSpeaker().
export interface Speaker {
  /** interrupt: drop anything queued or being spoken first. */
  speak(text: string, interrupt: boolean): void;
  cancel(): void;
}

let live: unknown[] = []; // browsers can drop an utterance that nothing references

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  const voices = synth.getVoices();
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return en.find((v) => v.lang.toLowerCase() === lang.toLowerCase() && v.localService) ?? en.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? en.find((v) => v.localService) ?? en[0];
}

export function webSpeaker(synth: SpeechSynthesis | undefined = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis): Speaker {
  return {
    speak(text, interrupt) {
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
      if (interrupt) { synth.cancel(); live = []; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      const v = pickVoice(synth);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = 1;
      const done = () => { live = live.filter((x) => x !== u); };
      u.onend = done;
      u.onerror = done;
      live.push(u);
      synth.speak(u);
      if (synth.paused) synth.resume();
    },
    cancel() { synth?.cancel(); live = []; },
  };
}

let speaker: Speaker = webSpeaker();

/** Replace the speech engine (the native build passes its text-to-speech here). */
export function setSpeaker(s: Speaker) { speaker = s; }

export function speak(text: string, interrupt = false) { speaker.speak(text, interrupt); }
export function cancelSpeech() { speaker.cancel(); }
