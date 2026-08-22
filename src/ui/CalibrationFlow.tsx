/**
 * Calibration.
 *
 * Records the user's own version of each letter and fits a classifier to it in
 * the browser. Four minutes of work for the largest accuracy gain available
 * anywhere in this app, which is why it is offered on first run and never
 * buried.
 *
 * The flow deliberately captures a *burst* per sample rather than one frame, so
 * a sample represents the pose as actually held rather than one lucky instant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePipeline } from '@/vision/pipeline';
import { useSettings } from '@/store';
import {
  CalibrationRecorder,
  TARGET_SAMPLES_PER_LETTER,
  buildPrototypes,
  perLetterAccuracy,
  // trainLinearHead is superseded by fitPersonalHead; see mlpHead.ts.
} from '@/modes/fingerspell/calibration';
import { fitPersonalHead, isMlpHead } from '@/modes/fingerspell/mlpHead';
import { STATIC_LETTERS, letterHint } from '@/modes/fingerspell/letterTemplates';
import { featuresFor } from '@/modes/fingerspell/classifier';
import { pickHand } from '@/modes/fingerspell/useFingerspell';
import { loadCalibration, saveCalibration } from '@/db/idb';

const BURST_FRAMES = 6;

type Phase = 'intro' | 'recording' | 'training' | 'done';

export function CalibrationFlow({
  open,
  onClose,
  onFinished,
  letters = STATIC_LETTERS,
}: {
  open: boolean;
  onClose(): void;
  onFinished(): void;
  /**
   * Which letters to record. Defaults to all of them; the fist cluster is
   * offered on its own because four minutes is long enough that most people
   * never start, and six letters is where nearly all the errors are.
   *
   * A partial set is safe because both personal heads are confined to the
   * letters they have seen — recording six sharpens those six and leaves the
   * other eighteen exactly as they were. See classifier.ts.
   */
  letters?: readonly string[];
}) {
  const { subscribe, active } = usePipeline();
  const dominantHand = useSettings((s) => s.settings.recognition.dominantHand);

  const recorder = useMemo(() => new CalibrationRecorder(), []);
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [handSeen, setHandSeen] = useState(false);
  const [burst, setBurst] = useState(0);
  const [result, setResult] = useState<{
    perLetter: Record<string, number>;
    /** The fitted model's own held-out number, or null when it could not take one. */
    holdout: number | null;
  } | null>(null);

  const capturingRef = useRef(false);
  const remainingRef = useRef(0);
  const letter = letters[index];

  useEffect(() => {
    if (!open) return;
    void loadCalibration().then((stored) => {
      if (!stored) return;
      for (const sample of stored.samples) recorder.add(sample.label, sample.features);
      setCounts(tally(recorder));
    });
  }, [open, recorder]);

  useEffect(() => {
    if (!open) return;
    return subscribe((frame) => {
      const hand = pickHand(frame.hands, dominantHand);
      setHandSeen(Boolean(hand));
      if (!hand || !capturingRef.current || remainingRef.current <= 0) return;

      const aspect = frame.height > 0 ? frame.width / frame.height : 1;
      recorder.add(letter, featuresFor(hand, aspect));
      remainingRef.current -= 1;
      setBurst(BURST_FRAMES - remainingRef.current);

      if (remainingRef.current <= 0) {
        capturingRef.current = false;
        setBurst(0);
        setCounts(tally(recorder));
      }
    });
  }, [open, subscribe, dominantHand, letter, recorder]);

  const capture = useCallback(() => {
    if (capturingRef.current) return;
    remainingRef.current = BURST_FRAMES;
    capturingRef.current = true;
  }, []);

  const finish = useCallback(async () => {
    setPhase('training');
    // Yield a frame so the "fitting" state paints before the loop blocks.
    await new Promise((r) => setTimeout(r, 30));
    const samples = [...recorder.all];
    const head = fitPersonalHead(samples);
    await saveCalibration(samples, head);
    buildPrototypes(samples);
    setResult({
      perLetter: perLetterAccuracy(samples),
      holdout: head && isMlpHead(head) ? head.holdoutAccuracy : null,
    });
    setPhase('done');
    onFinished();
  }, [recorder, onFinished]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (phase === 'recording' && e.key === ' ') {
        e.preventDefault();
        capture();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, capture, onClose]);

  if (!open) return null;

  const done = counts[letter] ?? 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const targetTotal = letters.length * TARGET_SAMPLES_PER_LETTER;
  const partial = letters.length < STATIC_LETTERS.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Calibration"
    >
      <div className="sb-panel max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-panel)] p-6 shadow-2xl">
        {phase === 'intro' && (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">
              {partial ? 'Teach it your fists' : 'Teach it your hands'}
            </h2>
            {partial ? (
              <>
                <p className="mt-2 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
                  {letters.join(', ')} are the same closed fist. The only thing that separates them
                  is where the thumb is — and in T, N and M the thumb is underneath the fingers,
                  where the camera cannot see it at all. No rule can recover that.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
                  A model fitted to your own hands can, because it learns what the tracker actually
                  reports for your T rather than what a T is supposed to look like. Six letters,
                  about ninety seconds.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
                  You will hold each of the 24 static letters and press capture a few times. It
                  takes about four minutes and it is the single largest accuracy improvement
                  available — a model fitted to your hands, your sleeves and your camera beats a
                  general one by a wide margin.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
                  J and Z are movements rather than poses and are recognised separately, so they are
                  not part of this.
                </p>
              </>
            )}
            <p className="mt-3 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
              Everything recorded here stays on this device.
            </p>
            {!active && (
              <p className="mt-3 rounded-xl border border-[var(--color-alert)] px-3 py-2 text-sm text-[var(--color-alert)]">
                The camera is not running. Start it first.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--sb-fg-muted)]">
                Not now
              </button>
              <button
                type="button"
                disabled={!active}
                onClick={() => setPhase('recording')}
                className="rounded-xl bg-[var(--color-signal)] px-4 py-2 text-sm font-semibold text-[#1a1200] disabled:opacity-40"
              >
                Start
              </button>
            </div>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
                  Letter {index + 1} of {letters.length}
                </p>
                <p className="font-[family-name:var(--font-display)] text-7xl leading-none font-bold text-[var(--color-signal)]">
                  {letter}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--sb-panel-edge)] px-3 py-1.5 text-xs"
              >
                Close
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
              {letterHint(letter)}
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${handSeen ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-alert)]'}`}
              />
              <span className="text-xs text-[var(--sb-fg-muted)]">
                {handSeen ? 'Hand tracked' : 'No hand in frame'}
              </span>
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-xs text-[var(--sb-fg-muted)]">
                <span>
                  {done} of {TARGET_SAMPLES_PER_LETTER} samples for {letter}
                </span>
                <span className="tabular-nums">
                  {total} / {targetTotal} total
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--sb-panel-edge)]">
                <div
                  className="h-full rounded-full bg-[var(--color-signal)] transition-[width]"
                  style={{ width: `${Math.min(100, (done / TARGET_SAMPLES_PER_LETTER) * 100)}%` }}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={capture}
                disabled={!handSeen}
                className="rounded-xl bg-[var(--color-signal)] px-5 py-2.5 text-sm font-semibold text-[#1a1200] disabled:opacity-40"
              >
                {burst > 0 ? `Capturing ${burst}/${BURST_FRAMES}` : 'Capture (Space)'}
              </button>
              <button
                type="button"
                onClick={() => {
                  recorder.removeLast(letter);
                  setCounts(tally(recorder));
                }}
                disabled={done === 0}
                className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-2.5 text-sm font-medium disabled:opacity-40"
              >
                Undo last
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-2.5 text-sm font-medium disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(letters.length - 1, i + 1))}
                disabled={index === letters.length - 1}
                className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-2.5 text-sm font-medium disabled:opacity-40"
              >
                Next letter
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={total < letters.length}
                title={
                  total < letters.length
                    ? 'Record at least one sample per letter first'
                    : undefined
                }
                className="ml-auto rounded-xl border border-[var(--color-signal)] px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                Fit model
              </button>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-[var(--sb-fg-muted)]">
              Vary it slightly between captures — turn your hand a few degrees, move nearer and
              further. Eight identical samples teach the model one exact pose and nothing else.
            </p>
          </>
        )}

        {phase === 'training' && (
          <div className="py-10 text-center">
            <p className="font-[family-name:var(--font-display)] text-xl font-bold">Fitting your model…</p>
            <p className="mt-2 text-sm text-[var(--sb-fg-muted)]">
              Fitting a small network to your samples, in this browser. A second or two.
            </p>
          </div>
        )}

        {phase === 'done' && result && (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">Calibrated</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
              {result.holdout === null ? (
                <>
                  Not enough samples to hold any back, so there is no accuracy figure to give you.
                  The model is fitted and running; record more of each letter to get one.
                </>
              ) : (
                <>
                  On samples it was not trained on:{' '}
                  <span className="font-semibold text-[var(--sb-fg)]">
                    {Math.round(result.holdout * 100)}%
                  </span>
                  . Treat that as a ceiling, not a forecast. Every sample came from this one
                  sitting — your light, your sleeves, your camera, your hand held the way it is
                  held right now. Measured against a later session it has run up to seven points
                  optimistic, and it says nothing at all about how this works for anyone else.
                </>
              )}
            </p>
            <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {letters.map((l) => {
                const acc = result.perLetter[l];
                const colour =
                  acc === undefined
                    ? 'var(--sb-panel-edge)'
                    : acc >= 0.9
                      ? 'var(--color-ok)'
                      : acc >= 0.7
                        ? 'var(--color-signal)'
                        : 'var(--color-alert)';
                return (
                  <div
                    key={l}
                    className="rounded-lg border px-1.5 py-1 text-center"
                    style={{ borderColor: colour }}
                    title={acc === undefined ? 'No samples' : `${Math.round(acc * 100)}% correct`}
                  >
                    <div className="font-[family-name:var(--font-display)] text-sm font-bold">{l}</div>
                    <div className="text-[10px] tabular-nums text-[var(--sb-fg-muted)]">
                      {acc === undefined ? '—' : `${Math.round(acc * 100)}`}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--sb-fg-muted)]">
              Per letter, by how far each sample sits from its own average — a rough guide to which
              ones to record more of, not the accuracy of the model above. M, N, S, T and E are hard
              for everyone: they differ only by where the thumb is, and the thumb is usually hidden.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPhase('recording');
                  setResult(null);
                }}
                className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-2 text-sm font-medium"
              >
                Record more
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-[var(--color-signal)] px-4 py-2 text-sm font-semibold text-[#1a1200]"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function tally(recorder: CalibrationRecorder): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const letter of STATIC_LETTERS) counts[letter] = recorder.countFor(letter);
  return counts;
}
