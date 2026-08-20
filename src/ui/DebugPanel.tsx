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
}: {
  open: boolean;
  onClose(): void;
  samples: readonly CalibrationSample[];
}) {
  const fps = useSession((s) => s.fps);
  const inferenceMs = useSession((s) => s.inferenceMs);
  const latencyMs = useSession((s) => s.latencyMs);
  const delegate = useSession((s) => s.delegate);
  const visionMode = useSession((s) => s.visionMode);
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
    <aside className="sb-on-video sb-panel absolute top-16 right-3 bottom-28 z-30 w-72 overflow-y-auto rounded-[var(--radius-panel)] p-4 text-xs">
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
      </dl>
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
