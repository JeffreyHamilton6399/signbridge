/**
 * Sign mode.
 *
 * Two recognisers running side by side:
 *
 *   1. Built-in signs — 28 common signs written as geometry rules
 *      (signTemplates.ts). No training, no dataset, works on first load.
 *   2. Custom signs — anything you record yourself, matched by nearest
 *      centroid. Covers what no dataset ever will: name signs, local signs,
 *      workplace jargon.
 *
 * Your own recordings win ties. They are a model of *you* making *that* sign,
 * which beats a general rule almost every time.
 *
 * Both have an explicit rejection band. When nothing matches well the mode says
 * nothing rather than emitting its least-bad guess, which is what stops the
 * transcript filling with noise every time you move between signs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePipeline } from '@/vision/pipeline';
import { useSession, useSettings } from '@/store';
import { PER_FRAME_DIM, WINDOW_FRAMES, frameFeatures, motionEnergy, resampleWindow } from '@/features/window';
import { FewShotMatcher, SAMPLES_PER_SIGN, SignSegmenter, buildPrototype, prototypeFromStored, toStored } from './fewShot';
import type { Prototype } from './fewShot';
import { observe, sampleFrame } from './observation';
import type { SignFrame } from './observation';
import { BUILT_IN_GLOSSES, CONFUSABLE, recognizeSign, signHint } from './signTemplates';
import { deleteCustomSign, listCustomSigns, putCustomSign } from '@/db/idb';

export function SignsMode({ recorderOpen, onCloseRecorder }: { recorderOpen: boolean; onCloseRecorder(): void }) {
  const { subscribe, active } = usePipeline();
  const dominantHand = useSettings((s) => s.settings.recognition.dominantHand);
  const threshold = useSettings((s) => s.settings.recognition.confidenceThreshold);
  const pushToken = useSession((s) => s.pushToken);
  const setAlternates = useSession((s) => s.setAlternates);

  const matcher = useMemo(() => new FewShotMatcher(), []);
  const segmenter = useMemo(() => new SignSegmenter(), []);
  const recentRef = useRef<Float32Array[]>([]);
  const observationRef = useRef<SignFrame[]>([]);

  const [signs, setSigns] = useState<Prototype[]>([]);
  const [status, setStatus] = useState<'idle' | 'signing'>('idle');
  const [lastMiss, setLastMiss] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const stored = await listCustomSigns();
    const prototypes = stored
      .map(prototypeFromStored)
      .filter((p): p is Prototype => p !== null);
    matcher.setPrototypes(prototypes);
    setSigns(prototypes);
  }, [matcher]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dominant = dominantHand === 'left' ? 'Left' : 'Right';

  useEffect(() => {
    if (recorderOpen) return; // The recorder owns the stream while it is open.
    return subscribe((frame) => {
      const features = frameFeatures(frame, dominant);
      const recent = recentRef.current;
      recent.push(features);
      if (recent.length > 6) recent.shift();

      // The rule recogniser needs richer per-frame data than the packed feature
      // vector carries, so it is collected in parallel and trimmed to the same
      // window the segmenter is accumulating.
      observationRef.current.push(sampleFrame(frame, dominant));
      if (observationRef.current.length > WINDOW_FRAMES * 2) observationRef.current.shift();

      const energy = motionEnergy(recent);
      const wasRecording = segmenter.recording;
      const completed = segmenter.push(features, energy);
      setStatus(segmenter.recording ? 'signing' : 'idle');
      if (!wasRecording && segmenter.recording) {
        // A new sign just started; drop everything before it.
        observationRef.current = observationRef.current.slice(-2);
      }
      if (!completed) return;

      const frames = observationRef.current.slice();
      observationRef.current = [];

      // 1. The user's own recordings.
      const window = resampleWindow(completed);
      const custom = matcher.match(window);

      // 2. The built-in rules.
      const observation = observe(frames);
      const builtIn = observation ? recognizeSign(observation) : [];

      const candidates = [
        // A personal prototype gets a deliberate edge: it was recorded by this
        // signer, in this room, with this camera.
        ...custom.map((m) => ({ label: m.label, confidence: Math.min(1, m.confidence * 1.15) })),
        ...builtIn.map((m) => ({ label: m.gloss, confidence: m.confidence })),
      ].sort((a, b) => b.confidence - a.confidence);

      setAlternates(candidates.slice(0, 3));

      const best = candidates[0];
      if (best && best.confidence >= threshold) {
        pushToken(best.label, best.confidence);
        setLastMiss(null);
      } else if (best) {
        // Near-misses are shown rather than swallowed: knowing it nearly saw
        // THANK-YOU is far more useful than silence.
        setLastMiss(`${best.label} (${Math.round(best.confidence * 100)}%, below threshold)`);
      } else {
        setLastMiss('no match');
      }
    });
  }, [subscribe, dominant, matcher, segmenter, threshold, pushToken, setAlternates, recorderOpen]);

  return (
    <>
      <div className="pointer-events-none absolute top-28 left-3 z-30 hidden max-w-xs sm:block">
        <div className="sb-panel sb-on-video rounded-2xl p-3 text-xs">
          <p className="font-semibold">
            {BUILT_IN_GLOSSES.length} built-in signs
            {signs.length > 0 && ` · ${signs.length} of yours`}
          </p>
          <p className="mt-1 leading-relaxed text-[var(--sb-fg-muted)]">
            Rule-based, no training. Accuracy is well below a trained model and several signs are
            genuinely hard to tell apart — record your own version of any sign it keeps missing.
          </p>
          <p className="mt-2 flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${status === 'signing' ? 'bg-[var(--color-signal)]' : 'bg-[var(--sb-panel-edge)]'}`}
            />
            <span className="text-[var(--sb-fg-muted)]">
              {status === 'signing' ? 'Movement detected' : lastMiss ? `Last: ${lastMiss}` : 'Waiting for movement'}
            </span>
          </p>
        </div>
      </div>

      <SignReference />

      <SignRecorder
        open={recorderOpen}
        onClose={onCloseRecorder}
        onSaved={reload}
        signs={signs}
        dominant={dominant}
        active={active}
      />
    </>
  );
}

/**
 * The list of signs that actually work, with how to make each one.
 *
 * A recogniser with a 28-sign vocabulary is useless unless you know which 28.
 * Hiding that in documentation would make the mode look broken.
 */
function SignReference() {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute right-2 bottom-32 z-30 max-w-[min(22rem,calc(100vw-1rem))]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sb-panel sb-on-video ml-auto flex rounded-xl px-3 py-2 text-xs font-medium"
      >
        {open ? 'Hide sign list' : `What it knows (${BUILT_IN_GLOSSES.length})`}
      </button>

      {open && (
        <div className="sb-panel sb-on-video sb-scroll mt-2 max-h-[52vh] overflow-y-auto rounded-2xl p-3">
          <ul className="space-y-2">
            {BUILT_IN_GLOSSES.map((gloss) => (
              <li key={gloss} className="text-xs">
                <span className="font-[family-name:var(--font-display)] text-sm font-bold">
                  {gloss}
                </span>
                <p className="mt-0.5 leading-relaxed text-[var(--sb-fg-muted)]">{signHint(gloss)}</p>
                {CONFUSABLE[gloss] && (
                  <p className="mt-0.5 text-[10px] text-[var(--color-alert)]">
                    often confused with {CONFUSABLE[gloss].join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type RecorderPhase = 'naming' | 'recording' | 'saving';

function SignRecorder({
  open,
  onClose,
  onSaved,
  signs,
  dominant,
  active,
}: {
  open: boolean;
  onClose(): void;
  onSaved(): Promise<void>;
  signs: Prototype[];
  dominant: 'Left' | 'Right';
  active: boolean;
}) {
  const { subscribe } = usePipeline();
  const [phase, setPhase] = useState<RecorderPhase>('naming');
  const [label, setLabel] = useState('');
  const [samples, setSamples] = useState<Float32Array[]>([]);
  const [capturing, setCapturing] = useState(false);
  const bufferRef = useRef<Float32Array[]>([]);
  const capturingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setPhase('naming');
      setLabel('');
      setSamples([]);
      setCapturing(false);
      capturingRef.current = false;
      bufferRef.current = [];
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return subscribe((frame) => {
      if (!capturingRef.current) return;
      bufferRef.current.push(frameFeatures(frame, dominant));
      // Hard cap so a forgotten recording cannot grow without bound.
      if (bufferRef.current.length > WINDOW_FRAMES * 3) stopCapture();
    });

    function stopCapture() {
      capturingRef.current = false;
      setCapturing(false);
      const collected = bufferRef.current;
      bufferRef.current = [];
      if (collected.length >= 6) {
        setSamples((prev) => [...prev, resampleWindow(collected)]);
      }
    }
  }, [open, subscribe, dominant]);

  const startCapture = () => {
    bufferRef.current = [];
    capturingRef.current = true;
    setCapturing(true);
  };

  const endCapture = () => {
    capturingRef.current = false;
    setCapturing(false);
    const collected = bufferRef.current;
    bufferRef.current = [];
    if (collected.length >= 6) setSamples((prev) => [...prev, resampleWindow(collected)]);
  };

  const save = async () => {
    setPhase('saving');
    const id = `${label.toUpperCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
    const prototype = buildPrototype(id, label.toUpperCase(), samples);
    if (prototype) await putCustomSign(toStored(prototype, samples));
    await onSaved();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Record a custom sign"
    >
      <div className="sb-panel max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-panel)] p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">Custom signs</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--sb-panel-edge)] px-3 py-1.5 text-xs">
            Close
          </button>
        </div>

        {phase === 'naming' && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
              Record {SAMPLES_PER_SIGN} examples of a sign and it will be recognised from then on,
              ahead of the built-in rules. Use this for your name sign, local signs, jargon — and
              for any built-in sign the rules keep getting wrong on you.
            </p>
            <label className="mt-4 block text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
              What is this sign called?
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. ALEX or DAILY-STANDUP"
                className="mt-1.5 w-full rounded-xl border border-[var(--sb-panel-edge)] bg-transparent px-3 py-2.5 text-base font-semibold normal-case tracking-normal outline-none focus:border-[var(--color-signal)]"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BUILT_IN_GLOSSES.slice(0, 12).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setLabel(s)}
                  className="rounded-lg border border-[var(--sb-panel-edge)] px-2 py-1 text-[11px] hover:border-[var(--color-signal)]"
                  title={`Override the built-in rule for ${s} with your own version`}
                >
                  {s}
                </button>
              ))}
            </div>

            {signs.length > 0 && (
              <div className="mt-5">
                <h3 className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
                  Recorded
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {signs.map((sign) => (
                    <li key={sign.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold">{sign.label}</span>
                      <span className="text-xs text-[var(--sb-fg-muted)]">
                        {sign.sampleCount} example{sign.sampleCount === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteCustomSign(sign.id);
                          await onSaved();
                        }}
                        className="rounded-lg border border-[var(--color-alert)] px-2 py-1 text-[11px] text-[var(--color-alert)]"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={!label.trim() || !active}
                onClick={() => setPhase('recording')}
                className="rounded-xl bg-[var(--color-signal)] px-5 py-2.5 text-sm font-semibold text-[#1a1200] disabled:opacity-40"
              >
                {active ? 'Start recording' : 'Camera is off'}
              </button>
            </div>
          </>
        )}

        {phase === 'recording' && (
          <>
            <p className="mt-2 text-sm text-[var(--sb-fg-muted)]">
              Hold the button, perform <span className="font-semibold text-[var(--sb-fg)]">{label.toUpperCase()}</span>,
              release. Start and end at rest with your hands down.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--sb-panel-edge)]">
                <div
                  className="h-full rounded-full bg-[var(--color-signal)] transition-[width]"
                  style={{ width: `${Math.min(100, (samples.length / SAMPLES_PER_SIGN) * 100)}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-[var(--sb-fg-muted)]">
                {samples.length} / {SAMPLES_PER_SIGN}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onPointerDown={startCapture}
                onPointerUp={endCapture}
                onPointerLeave={() => capturing && endCapture()}
                className={`rounded-xl px-6 py-3 text-sm font-semibold transition-colors ${
                  capturing
                    ? 'bg-[var(--color-alert)] text-white'
                    : 'bg-[var(--color-signal)] text-[#1a1200]'
                }`}
              >
                {capturing ? 'Recording — release to stop' : 'Hold to record'}
              </button>
              <button
                type="button"
                onClick={() => setSamples((prev) => prev.slice(0, -1))}
                disabled={samples.length === 0}
                className="rounded-xl border border-[var(--sb-panel-edge)] px-4 py-3 text-sm font-medium disabled:opacity-40"
              >
                Undo last
              </button>
              <button
                type="button"
                onClick={save}
                disabled={samples.length < 3}
                title={samples.length < 3 ? 'Record at least three examples' : undefined}
                className="ml-auto rounded-xl border border-[var(--color-signal)] px-4 py-3 text-sm font-semibold disabled:opacity-40"
              >
                Save sign
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--sb-fg-muted)]">
              Vary speed and position slightly between takes. {SAMPLES_PER_SIGN} examples is the
              target; three is the minimum and it will be noticeably worse.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--sb-fg-muted)]">
              Feature vector: {WINDOW_FRAMES} frames × {PER_FRAME_DIM} values, body-relative. Stored
              on this device only.
            </p>
          </>
        )}

        {phase === 'saving' && <p className="py-10 text-center text-sm">Saving…</p>}
      </div>
    </div>
  );
}
