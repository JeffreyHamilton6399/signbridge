/**
 * "A new version is ready."
 *
 * Visible, not a console message. A cached build that cannot be replaced is a
 * broken app with no way out, and the user has no reason to suspect the cache —
 * from the outside it just looks like the bug was never fixed.
 *
 * It does not swap anything under a running session: the reload is the user's
 * decision, and dismissing it is allowed.
 */
import { useUpdate } from '@/pwa';

export function UpdatePrompt() {
  const updateReady = useUpdate((s) => s.updateReady);
  const dismissed = useUpdate((s) => s.dismissed);
  const apply = useUpdate((s) => s.apply);
  const dismiss = useUpdate((s) => s.dismiss);

  if (!updateReady || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="sb-panel flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl">
        <p className="text-sm font-medium">
          A newer version of SignBridge is ready.
          <span className="ml-1 text-[var(--sb-fg-muted)]">
            Reload to use it — your settings and calibration are kept.
          </span>
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-[var(--sb-fg-muted)] hover:text-[var(--sb-fg)]"
          >
            Later
          </button>
          <button
            type="button"
            onClick={apply}
            className="rounded-xl bg-[var(--color-signal)] px-4 py-1.5 text-sm font-semibold text-[#1a1200] hover:brightness-110"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
