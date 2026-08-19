/**
 * Reverse mode - English in, ASL out.
 *
 * The English -> gloss step is a real translation, not a word swap: articles and
 * copulas are dropped, time moves to the front, negation follows the verb, and
 * wh-signs move to the end. The rules that fired are shown, so the output is
 * inspectable rather than magic.
 *
 * Output is clip-based. With no clips installed - the default - every gloss is
 * fingerspelled, which is honest and still useful. The avatar path stays behind
 * an experimental flag because no open, production-quality ASL avatar exists and
 * a bad one is worse than none.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { englishToGloss, glossToString } from './glossEngine';
import type { GlossResult } from './glossEngine';
import { ClipDictionary, buildPlayback } from './clips';
import type { PlaybackStep } from './clips';
import { SpeechInput, sttSupported } from '@/speech/stt';
import { useSettings } from '@/store';
import { letterHint } from '@/modes/fingerspell/letterTemplates';

const LETTER_MS = 420;

export function ReverseMode() {
  const settings = useSettings((s) => s.settings);
  const [input, setInput] = useState('');
  const [dictionary, setDictionary] = useState<ClipDictionary | null>(null);
  const [listening, setListening] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const speech = useMemo(() => new SpeechInput(), []);

  useEffect(() => {
    void ClipDictionary.load().then(setDictionary);
    return () => speech.stop();
  }, [speech]);

  const gloss: GlossResult = useMemo(
    () => englishToGloss(input, { available: dictionary?.availableGlosses() }),
    [input, dictionary],
  );

  const steps = useMemo(
    () => (dictionary ? buildPlayback(gloss.tokens, dictionary) : []),
    [gloss, dictionary],
  );

  const toggleListening = useCallback(() => {
    if (listening) {
      speech.stop();
      setListening(false);
      return;
    }
    setSttError(null);
    const started = speech.start({
      language: settings.speechIn.language,
      interimResults: settings.speechIn.interimResults,
      continuous: !settings.speechIn.pushToTalk,
      onResult: (r) => setInput((prev) => (r.isFinal ? `${prev} ${r.transcript}`.trim() : prev)),
      onError: (message) => {
        setSttError(message);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    setListening(started);
  }, [listening, speech, settings.speechIn]);

  return (
    <div className="sb-scroll h-full overflow-y-auto px-4 pt-16 pb-32">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">
            English to ASL
          </h1>
          <span className="rounded-full border border-[var(--color-signal)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-signal)]">
            Approximate
          </span>
        </header>
        <p className="mt-2 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
          This produces an ASL gloss and plays it back sign by sign. It cannot do classifiers,
          spatial referencing, role shift, or verb agreement through space — the parts of ASL that
          carry the most meaning. Treat the output as a sketch, not a translation you would rely on.
        </p>

        <div className="mt-5">
          <label htmlFor="reverse-input" className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
            English
          </label>
          <textarea
            id="reverse-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="Type a sentence, or use the microphone."
            className="mt-1.5 w-full resize-y rounded-2xl border border-[var(--sb-panel-edge)] bg-[var(--sb-panel)] px-4 py-3 text-lg outline-none focus:border-[var(--color-signal)]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleListening}
              disabled={!sttSupported()}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                listening
                  ? 'border-[var(--color-alert)] text-[var(--color-alert)]'
                  : 'border-[var(--sb-panel-edge)] hover:border-[var(--color-signal)]'
              } disabled:opacity-40`}
            >
              {listening ? 'Stop listening' : 'Speak'}
            </button>
            <button
              type="button"
              onClick={() => setInput('')}
              disabled={!input}
              className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              Clear
            </button>
            {!sttSupported() && (
              <span className="text-xs text-[var(--sb-fg-muted)]">
                This browser has no speech recognition. Typing works everywhere.
              </span>
            )}
            {sttSupported() && (
              <span className="text-xs text-[var(--sb-fg-muted)]">
                Speech recognition sends audio to your browser vendor. Typed input does not.
              </span>
            )}
          </div>
          {sttError && (
            <p role="alert" className="mt-2 text-sm text-[var(--color-alert)]">
              {sttError}
            </p>
          )}
        </div>

        {gloss.tokens.length > 0 && (
          <>
            <section className="mt-7">
              <h2 className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
                ASL gloss
              </h2>
              <p className="mt-2 font-[family-name:var(--font-display)] text-2xl leading-snug font-bold">
                {gloss.tokens.map((token, i) => (
                  <span
                    key={`${token.gloss}-${i}`}
                    className={`mr-2 inline-block ${
                      token.kind === 'nmm'
                        ? 'text-base font-medium text-[var(--color-tentative)] italic'
                        : token.fallback
                          ? 'text-[var(--color-signal)]'
                          : ''
                    }`}
                    title={
                      token.fallback
                        ? `No clip for ${token.gloss.slice(3, -1)} — it will be fingerspelled`
                        : `from "${token.source}"`
                    }
                  >
                    {token.gloss}
                  </span>
                ))}
              </p>
              <p className="mt-1.5 font-mono text-xs text-[var(--sb-fg-muted)]">
                {glossToString(gloss)}
              </p>
            </section>

            <section className="mt-5">
              <h2 className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
                Why it looks like that
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-[var(--sb-fg-muted)]">
                {gloss.notes.map((note) => (
                  <li key={note} className="flex gap-2">
                    <span className="text-[var(--color-signal)]">—</span>
                    <span>{note}</span>
                  </li>
                ))}
                {gloss.notes.length === 0 && <li>Word order was already close to ASL order.</li>}
              </ul>
            </section>

            <Player steps={steps} hasClips={(dictionary?.size ?? 0) > 0} />
          </>
        )}

        {settings.experimental.avatarOutput && (
          <section className="mt-7 rounded-2xl border border-[var(--color-alert)] p-4">
            <h2 className="text-sm font-semibold text-[var(--color-alert)]">
              Avatar output is not implemented
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
              There is no open, production-quality ASL avatar to build on. A rigged model driven by
              this gloss stream would produce handshapes that are close but wrong, with no
              non-manual markers at all — which reads as fluent and is not. The flag exists so the
              decision is visible, not because something is hidden behind it.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function Player({ steps, hasClips }: { steps: PlaybackStep[]; hasClips: boolean }) {
  const [index, setIndex] = useState(0);
  const [letterIndex, setLetterIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const stop = useCallback(() => {
    setPlaying(false);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    stop();
    setIndex(0);
    setLetterIndex(0);
  }, [steps, stop]);

  useEffect(() => {
    if (!playing) return;
    const step = steps[index];
    if (!step) {
      stop();
      return;
    }

    if (step.kind === 'fingerspell') {
      if (letterIndex >= step.letters.length) {
        timer.current = window.setTimeout(() => {
          setIndex((i) => i + 1);
          setLetterIndex(0);
        }, 220);
        return;
      }
      timer.current = window.setTimeout(() => setLetterIndex((l) => l + 1), LETTER_MS);
      return;
    }

    if (step.kind === 'nmm') {
      timer.current = window.setTimeout(() => setIndex((i) => i + 1), 700);
      return;
    }

    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.play();
    }
    timer.current = window.setTimeout(() => setIndex((i) => i + 1), step.entry.durationMs || 900);
  }, [playing, index, letterIndex, steps, stop]);

  useEffect(() => () => stop(), [stop]);

  const step = steps[index];

  return (
    <section className="mt-7">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
          Playback
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setLetterIndex(0);
              setPlaying(true);
            }}
            className="rounded-xl bg-[var(--color-signal)] px-4 py-1.5 text-sm font-semibold text-[#1a1200]"
          >
            Play
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!playing}
            className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="mt-3 grid aspect-video w-full place-items-center overflow-hidden rounded-2xl border border-[var(--sb-panel-edge)] bg-black/25">
        {!step && (
          <p className="px-6 text-center text-sm text-[var(--sb-fg-muted)]">
            Press play to step through the gloss.
          </p>
        )}
        {step?.kind === 'clip' && (
          <video ref={videoRef} src={step.entry.file} muted playsInline className="h-full w-full object-contain" />
        )}
        {step?.kind === 'fingerspell' && (
          <div className="text-center">
            <p className="font-[family-name:var(--font-display)] text-[clamp(4rem,18vw,9rem)] leading-none font-bold text-[var(--color-signal)]">
              {step.letters[Math.min(letterIndex, step.letters.length - 1)] ?? '·'}
            </p>
            <p className="mt-2 text-sm text-[var(--sb-fg-muted)]">
              Fingerspelling <span className="font-semibold text-[var(--sb-fg)]">{step.gloss}</span>
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--sb-fg-muted)]">
              {letterHint(step.letters[Math.min(letterIndex, step.letters.length - 1)] ?? '')}
            </p>
          </div>
        )}
        {step?.kind === 'nmm' && (
          <p className="px-6 text-center font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--color-tentative)] italic">
            {step.description}
            <span className="mt-2 block text-sm font-medium not-italic text-[var(--sb-fg-muted)]">
              A non-manual marker. Clips cannot perform this; a signer would.
            </span>
          </p>
        )}
      </div>

      {!hasClips && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--sb-fg-muted)]">
          No sign clips are installed, so everything is fingerspelled. See{' '}
          <code className="font-mono">public/clips/README.md</code> — recording your own with Deaf
          signers is the better path, and licensing terms matter.
        </p>
      )}
    </section>
  );
}
