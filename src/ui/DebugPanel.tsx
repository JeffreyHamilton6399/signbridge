/**
 * Debug panel.
 *
 * Exists so that "how good is this actually" has an answer inside the app
 * rather than in a README nobody reads. It reports per-letter accuracy from the
 * user's own calibration set, the live class distribution, and the frame budget.
 *
 * If the numbers here are bad, the fix is a better model or more calibration
 * data - not a lower confidence threshold.
 */
import { useEffect, useState } from 'react';
import { useSession } from '@/store';
import { perLetterAccuracy } from '@/modes/fingerspell/calibration';
import type { CalibrationSample } from '@/modes/fingerspell/calibration';
import { CONFUSION_CLUSTERS, STATIC_LETTERS } from '@/modes/fingerspell/letterTemplates';

export function DebugPanel({
  open,
  onClose,
  samples,
  personalModel,
}: {
  open: boolean;
  onClose(): void;
  samples: readonly CalibrationSample[];
  personalModel: { kind: 'mlp' | 'linear'; letters: number; holdout: number | null } | null;
}) {
  const fps = useSession((s) => s.fps);
  const inferenceMs = useSession((s) => s.inferenceMs);
  const latencyMs = useSession((s) => s.latencyMs);
  const delegate = useSession((s) => s.delegate);
  const visionMode = useSession((s) => s.visionMode);
  const handSpace = useSession((s) => s.handSpace);
  const distribution = useSession((s) => s.distribution);
  const [perLetter, setPerLetter] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open || samples.length === 0) return;
    // Leave-one-out over every sample is O(n^2); keep it off the frame path.
    const handle = setTimeout(() => setPerLetter(perLetterAccuracy(samples)), 0);
    return () => clearTimeout(handle);
  }, [open, samples]);

  if (!open) return null;

  const top = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const budgetOk = latencyMs < 150;

  return (
    <aside className="sb-on-video sb-panel absolute top-28 right-2 bottom-28 left-2 z-30 overflow-y-auto rounded-[var(--radius-panel)] p-4 text-xs sm:top-16 sm:right-3 sm:left-auto sm:w-72">
      <div className="flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-base font-bold">Debug</h2>
        <button type="button" onClick={onClose} aria-label="Close debug panel" className="text-[var(--sb-fg-muted)]">
          ✕
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 tabular-nums">
        <dt className="text-[var(--sb-fg-muted)]">Capture</dt>
        <dd className="text-right">{fps.toFixed(1)} fps</dd>
        <dt className="text-[var(--sb-fg-muted)]">Landmarking</dt>
        <dd className="text-right">{inferenceMs.toFixed(1)} ms</dd>
        <dt className="text-[var(--sb-fg-muted)]">End-to-end</dt>
        <dd className={`text-right ${budgetOk ? '' : 'text-[var(--color-alert)]'}`}>
          {latencyMs.toFixed(0)} ms
        </dd>
        <dt className="text-[var(--sb-fg-muted)]">Delegate</dt>
        <dd className="text-right">{delegate ?? '—'}</dd>
        <dt className="text-[var(--sb-fg-muted)]">Runs on</dt>
        <dd className={`text-right ${visionMode === 'inline' ? 'text-[var(--color-signal)]' : ''}`}>
          {visionMode === 'inline' ? 'main thread' : visionMode === 'worker' ? 'worker' : '—'}
        </dd>
        <dt className="text-[var(--sb-fg-muted)]">Shape read in</dt>
        <dd className={`text-right ${handSpace === 'image' ? 'text-[var(--color-signal)]' : ''}`}>
          {handSpace === 'world' ? 'world 3D' : handSpace === 'image' ? 'image 2D' : '—'}
        </dd>
        {/* Which personal model is live. A head that fails to load, or loads
            into a slot nothing reads, produces no error anywhere and silently
            drops the app back to geometric rules — that bug has shipped here
            before, so it gets a line of its own. */}
        <dt className="text-[var(--sb-fg-muted)]">Personal model</dt>
        <dd className={`text-right ${personalModel ? '' : 'text-[var(--color-signal)]'}`}>
          {personalModel === null
            ? 'none — rules only'
            : `${personalModel.kind === 'mlp' ? 'MLP' : 'linear'}, ${personalModel.letters} letters`}
        </dd>
      </dl>
      {personalModel?.holdout != null && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--sb-fg-muted)]">
          {Math.round(personalModel.holdout * 100)}% on samples it was not fitted on — a ceiling,
          not a forecast. Same sitting, same light, same signer.
        </p>
      )}
      {handSpace === 'image' && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-signal)]">
          No metric landmarks from the tracker, so handshape is being read off the flat image.
          Letters that point toward the camera will read as curled. Keep your palm facing the lens.
        </p>
      )}
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--sb-fg-muted)]">
        Budget is 150 ms gesture to caption. {budgetOk ? 'Within budget.' : 'Over budget — try power saving off, or a lower resolution.'}
      </p>
      {visionMode === 'inline' && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-signal)]">
          This browser cannot run hand tracking in a background thread, so it is sharing the main
          one and capped at 20 fps. Expect choppier captions. Safari 17+, Chrome or Edge use the
          faster path.
        </p>
      )}

      <h3 className="mt-4 font-semibold">Live distribution</h3>
      <ul className="mt-1.5 space-y-1">
        {top.length === 0 && <li className="text-[var(--sb-fg-muted)]">No hand in frame.</li>}
        {top.map(([letter, p]) => (
          <li key={letter} className="flex items-center gap-2">
            <span className="w-4 font-[family-name:var(--font-display)] font-bold">{letter}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--sb-panel-edge)]">
              <span
                className="block h-full bg-[var(--color-signal)]"
                style={{ width: `${Math.round(p * 100)}%` }}
              />
            </span>
            <span className="w-8 text-right text-[10px] text-[var(--sb-fg-muted)]">
              {Math.round(p * 100)}%
            </span>
          </li>
        ))}
      </ul>

      <FistEvidence />

      <h3 className="mt-4 font-semibold">Per-letter accuracy</h3>
      {samples.length === 0 ? (
        <p className="mt-1.5 leading-relaxed text-[var(--sb-fg-muted)]">
          No calibration data. Without it, the app is running on geometric rules alone and accuracy
          is unmeasured — run calibration to get a real number.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--sb-fg-muted)]">
            Leave-one-out on your own samples. Not a held-out signer, so read it as an upper bound.
          </p>
          <div className="mt-2 grid grid-cols-6 gap-1">
            {STATIC_LETTERS.map((letter) => {
              const acc = perLetter[letter];
              const colour =
                acc === undefined
                  ? 'var(--sb-fg-muted)'
                  : acc >= 0.9
                    ? 'var(--color-ok)'
                    : acc >= 0.7
                      ? 'var(--color-signal)'
                      : 'var(--color-alert)';
              return (
                <div
                  key={letter}
                  className="text-center"
                  title={
                    acc === undefined
                      ? 'No samples'
                      : `${Math.round(acc * 100)}% — often confused with ${(CONFUSION_CLUSTERS[letter] ?? []).join(', ') || 'nothing in particular'}`
                  }
                >
                  <div className="font-[family-name:var(--font-display)] font-bold" style={{ color: colour }}>
                    {letter}
                  </div>
                  <div className="text-[9px] tabular-nums text-[var(--sb-fg-muted)]">
                    {acc === undefined ? '—' : Math.round(acc * 100)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * The three numbers behind A / S / E / T / N / M.
 *
 * These letters are one closed fist with the thumb in six places, and in T, N
 * and M that thumb is underneath the fingers where the camera cannot see it —
 * so the templates decide them on the fingers instead, which are in plain view.
 * The bands they use for that are reasoned from how the letters are formed
 * rather than measured from signers, and this readout is how that reasoning
 * gets checked: hold each letter, watch which row moves.
 *
 * The expected reading is on every row, so a hand that disagrees is obvious
 * without knowing the code. If yours does, calibrating the six is the fix —
 * a fitted head learns your numbers instead of these.
 */
function FistEvidence() {
  const e = useSession((s) => s.fistEvidence);

  const rows = [
    {
      label: 'Fingers over thumb',
      value: e === null ? null : e.drapedCount,
      expected: 'T 1 · N 2 · M 3 · A/S/E 0',
      seen: true,
    },
    {
      label: 'Tips off palm',
      value: e === null ? null : e.tipLift,
      expected: 'A/S ~0.15 · E/T/N/M ~0.34',
      seen: true,
    },
    {
      label: 'Thumb across knuckles',
      value: e === null ? null : e.thumbAcross,
      expected: 'A <0 · T 0.3 · N 0.55 · M 0.85',
      seen: false,
    },
  ];

  return (
    <>
      <h3 className="mt-4 font-semibold">Fist cluster</h3>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--sb-fg-muted)]">
        A, S, E, T, N and M are the same fist. Hold each one and watch these move.
      </p>
      <dl className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between gap-2">
              <dt className={row.seen ? '' : 'text-[var(--sb-fg-muted)]'}>{row.label}</dt>
              <dd className="tabular-nums">{row.value === null ? '—' : row.value.toFixed(2)}</dd>
            </div>
            <div className="text-[9px] text-[var(--sb-fg-muted)]">{row.expected}</div>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--sb-fg-muted)]">
        The first two are measured off fingers the camera can see. The third is the tracker's
        guess at a thumb hidden under them, which is why it counts for least — and why a T or an
        M used to read as an A. If your hand does not match these bands, calibrate the six fists.
      </p>
    </>
  );
}
