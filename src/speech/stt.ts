/**
 * Speech to text for Reverse mode.
 *
 * Uses the Web Speech API where it exists (Chrome, Edge, Safari 16+). Firefox
 * has no implementation; there the UI falls back to typing, which is a fine
 * primary input anyway. A Whisper-web fallback is a possible future addition -
 * it would be a ~40 MB download, so it must be opt-in, and it is deliberately
 * not wired up by default.
 *
 * Nothing here uploads audio: the Web Speech API in Chrome does use a server for
 * recognition, which is why Reverse mode's speech input carries its own explicit
 * notice in the UI. Typed input never leaves the device.
 */

export interface SttResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

export interface SttOptions {
  language?: string;
  interimResults?: boolean;
  continuous?: boolean;
  onResult(result: SttResult): void;
  onError?(message: string): void;
  onEnd?(): void;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [alt: number]: { transcript: string; confidence: number };
    };
  };
}

function constructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

export function sttSupported(): boolean {
  return constructor() !== null;
}

/**
 * Browser speech recognition sends audio to a remote service in Chrome and
 * Edge. The UI must say so before this is switched on.
 */
export const STT_USES_NETWORK = true;

export class SpeechInput {
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;

  get active(): boolean {
    return this.listening;
  }

  start(options: SttOptions): boolean {
    const Ctor = constructor();
    if (!Ctor) {
      options.onError?.('This browser cannot listen for speech. Type instead.');
      return false;
    }
    this.stop();

    const recognition = new Ctor();
    recognition.lang = options.language ?? 'en-US';
    recognition.interimResults = options.interimResults ?? true;
    recognition.continuous = options.continuous ?? false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        options.onResult({
          transcript: alt.transcript,
          isFinal: result.isFinal,
          confidence: alt.confidence || 0,
        });
      }
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Microphone permission was blocked. Allow it in your browser settings.',
        'no-speech': 'Nothing was heard. Try again, closer to the microphone.',
        network: 'Speech recognition needs a network connection in this browser.',
        'audio-capture': 'No microphone was found. Plug one in and try again.',
      };
      options.onError?.(messages[event.error] ?? `Speech recognition failed: ${event.error}`);
      this.listening = false;
    };
    recognition.onend = () => {
      this.listening = false;
      options.onEnd?.();
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.listening = true;
      return true;
    } catch (err) {
      options.onError?.(String(err));
      return false;
    }
  }

  stop(): void {
    if (this.recognition && this.listening) {
      try {
        this.recognition.stop();
      } catch {
        // Already stopped.
      }
    }
    this.listening = false;
    this.recognition = null;
  }
}
