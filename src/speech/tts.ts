/**
 * Text to speech via the Web Speech API.
 *
 * Two things make this less trivial than speechSynthesis.speak():
 *   - voices load asynchronously and the list is empty on first call in Chrome
 *   - speaking every committed letter would queue faster than it drains, so
 *     letter-level speech cancels anything still pending
 */

export interface SpeakOptions {
  voiceURI?: string | null;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Cancel anything currently queued first. Used for per-letter reading. */
  interrupt?: boolean;
}

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let voiceCache: SpeechSynthesisVoice[] = [];

export function getVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) voiceCache = voices;
  return voiceCache;
}

/** Resolves once the browser has actually populated the voice list. */
export function whenVoicesReady(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve([]);
    const existing = getVoices();
    if (existing.length > 0) return resolve(existing);

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.onvoiceschanged = null;
      resolve(getVoices());
    };
    window.speechSynthesis.onvoiceschanged = done;
    setTimeout(done, timeoutMs);
  });
}

export function speak(text: string, options: SpeakOptions = {}): void {
  if (!ttsSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  if (options.interrupt) synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  if (options.voiceURI) {
    const voice = getVoices().find((v) => v.voiceURI === options.voiceURI);
    if (voice) utterance.voice = voice;
  }
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;
  utterance.volume = options.volume ?? 1;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/**
 * Reads a letter aloud using its name rather than its phoneme, so "C" is
 * "see" and not a hard k. Interrupts, because letters arrive faster than
 * speech drains.
 */
export function speakLetter(letter: string, options: SpeakOptions = {}): void {
  speak(letter.toUpperCase(), { ...options, interrupt: true });
}

/**
 * Very light punctuation inference for read-aloud and transcript export.
 *
 * This does not attempt to be clever. It capitalises sentence starts and adds a
 * terminal period, and that is all - guessing question marks from a word list
 * would put words in the signer's mouth, which is exactly the failure mode this
 * app is supposed to avoid.
 */
export function inferPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}
