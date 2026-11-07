// Spoken directions inside the apps: native text-to-speech keeps talking with the screen off.
// Installed with setSpeaker() in main.tsx; browsers keep the Web Speech speaker in src/lib/voice/speak.ts.
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';
import type { Speaker } from '../voice/speak';

export function nativeSpeaker(tts: Pick<typeof TextToSpeech, 'speak' | 'stop'> = TextToSpeech): Speaker {
  return {
    speak(text, interrupt) {
      // category 'playback' (iOS) lets the line play with the screen locked; a failure must never break navigation
      tts.speak({ text, lang: 'en-US', rate: 1, category: 'playback', queueStrategy: interrupt ? QueueStrategy.Flush : QueueStrategy.Add }).catch(() => {});
    },
    cancel() { tts.stop().catch(() => {}); },
  };
}
