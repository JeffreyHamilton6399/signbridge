/**
 * Confidence, made visible.
 *
 * Never show a recognised word as if it were certain. This component carries
 * two facts at once: how sure the model is right now (the bar) and how close the
 * current letter is to committing (the ring). Both are also exposed to screen
 * readers as text, because a bar that only means something visually is not an
 * accessibility feature.
 */
import { useSession, useSettings } from '@/store';

export function ConfidenceBar() {
  const tentative = useSession((s) => s.tentative);
  const alternates = useSession((s) => s.alternates);
  const show = useSettings((s) => s.settings.display.showConfidenceBar);
  const threshold = useSettings((s) => s.settings.recognition.confidenceThreshold);

  if (!show) return null;

  const confidence = tentative?.confidence ?? alternates[0]?.confidence ?? 0;
  const pct = Math.round(confidence * 100);
  const state = confidence >= threshold ? 'strong' : confidence >= threshold * 0.7 ? 'weak' : 'poor';
  const color =
    state === 'strong'
      ? 'var(--color-signal)'
      : state === 'weak'
        ? 'var(--color-tentative)'
        : 'var(--color-alert)';

  return (
    <div
      className="flex items-center gap-3"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Recognition confidence ${pct} percent${tentative ? `, holding ${tentative.label}` : ''}`}
    >
      {tentative && <DwellRing progress={tentative.progress} label={tentative.label} />}
      <div className="min-w-24 flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sb-panel-edge)]">
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-[var(--sb-fg-muted)]">
          <span>{pct}% confident</span>
          <span>commits at {Math.round(threshold * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

/** The dwell timer, drawn as a ring closing around the pending letter. */
function DwellRing({ progress, label }: { progress: number; label: string }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-10 w-10 shrink-0">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--sb-panel-edge)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="var(--color-signal)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-[family-name:var(--font-display)] text-sm font-bold">
        {label}
      </span>
    </div>
  );
}

/**
 * Top-3 alternates. One tap swaps the guess - correction has to be cheaper than
 * re-signing, or nobody corrects anything and the transcript quietly rots.
 */
export function Alternates({ onPick }: { onPick(label: string): void }) {
  const alternates = useSession((s) => s.alternates);
  const show = useSettings((s) => s.settings.display.showAlternates);
  if (!show || alternates.length < 2) return null;

  return (
    <div className="flex items-center gap-1.5" aria-label="Other possible letters">
      {alternates.slice(1, 3).map((alt) => (
        <button
          key={alt.label}
          type="button"
          onClick={() => onPick(alt.label)}
          className="sb-panel rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-[var(--color-signal)]"
        >
          <span className="font-[family-name:var(--font-display)] text-sm">{alt.label}</span>
          <span className="ml-1.5 text-[10px] text-[var(--sb-fg-muted)]">
            {Math.round(alt.confidence * 100)}%
          </span>
        </button>
      ))}
    </div>
  );
}
