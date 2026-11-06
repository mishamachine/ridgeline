// Spoken directions. Native text-to-speech keeps talking with the screen off; browsers use the Web Speech API.
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';
import { isNative } from './platform';

export function canSpeak(): boolean {
  return isNative() || (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined');
}

/** Say something short. `flush` (default) cuts off whatever is being said. Never throws. */
export async function speak(text: string, opts: { lang?: string; flush?: boolean } = {}): Promise<void> {
  const lang = opts.lang ?? 'en-US';
  const flush = opts.flush ?? true;
  try {
    if (isNative()) {
      await TextToSpeech.speak({ text, lang, rate: 1, queueStrategy: flush ? QueueStrategy.Flush : QueueStrategy.Add, category: 'playback' });
    } else if (canSpeak()) {
      if (flush) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      speechSynthesis.speak(u);
    }
  } catch { /* voice is a helper; a failure must never break navigation */ }
}

export async function stopSpeaking(): Promise<void> {
  try {
    if (isNative()) await TextToSpeech.stop();
    else if (canSpeak()) speechSynthesis.cancel();
  } catch { /* ignore */ }
}
