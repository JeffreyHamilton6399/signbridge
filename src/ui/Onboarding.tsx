/**
 * Pre-permission explainer.
 *
 * The browser's camera prompt is a bad place to learn what an app does with
 * video. This screen answers that first, in the app's own words, and only then
 * asks. Users who deny at the OS prompt because nobody told them why are
 * expensive to win back - the permission can only be re-requested from browser
 * settings on most platforms.
 */
import { DisclaimerLong } from './Disclaimer';

export function Onboarding({
  onStart,
  starting,
  error,
  onRetry,
}: {
  onStart(): void;
  starting: boolean;
  error: { message: string; remedy: string } | null;
  onRetry(): void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <div className="w-full max-w-2xl">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[var(--color-signal)]">
          SignBridge
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-[clamp(2.2rem,6vw,3.6rem)] leading-[1.02] font-bold text-balance">
          Your camera reads the sign. Nothing leaves this device.
        </h1>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Point
            title="On-device"
            body="Landmark extraction and recognition both run in this browser tab. No frames, no landmarks, no transcripts are uploaded — there is no server to upload them to."
          />
          <Point
            title="Honest about doubt"
            body="Every letter shows how confident the model is, and the top alternates are one tap away. It will be wrong; the design assumes that."
          />
          <Point
            title="Not an interpreter"
            body="This is a recognition assistant. It is not safe for medical, legal, emergency, financial or educational-access conversations."
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-[var(--color-alert)] p-4"
          >
            <p className="text-sm font-semibold text-[var(--color-alert)]">{error.message}</p>
            <p className="mt-1 text-sm text-[var(--sb-fg-muted)]">{error.remedy}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-xl border border-[var(--color-alert)] px-4 py-2 text-sm font-semibold"
            >
              Retry
            </button>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="rounded-2xl bg-[var(--color-signal)] px-6 py-3 text-base font-semibold text-[#1a1200] transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {starting ? 'Starting camera…' : 'Turn on the camera'}
          </button>
          <p className="text-xs text-[var(--sb-fg-muted)]">
            Your browser will ask for permission next.
          </p>
        </div>

        <details className="group mt-8 rounded-2xl border border-[var(--sb-panel-edge)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            What this can and cannot do
          </summary>
          <div className="mt-3">
            <DisclaimerLong />
          </div>
        </details>
      </div>
    </div>
  );
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--sb-panel-edge)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-signal)]">{title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--sb-fg-muted)]">{body}</p>
    </div>
  );
}
