/**
 * Correction sheet.
 *
 * Correction is one tap from the caption. It has to be: a recogniser that is
 * wrong 15% of the time is fine if fixing it is trivial, and unusable if it is
 * not. Opens on the last word, offers the alternates the model actually
 * considered, and lets the user type over the top.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/store';
import { letterHint } from '@/modes/fingerspell/letterTemplates';

export function CorrectionSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const tokens = useSession((s) => s.tokens);
  const distribution = useSession((s) => s.distribution);
  const replaceLastToken = useSession((s) => s.replaceLastToken);
  const last = tokens[tokens.length - 1];
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(last?.text ?? '');
      // Focus after the sheet has painted so the transition does not eat it.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, last?.text]);

  if (!open) return null;

  const topLetters = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const commit = () => {
    if (draft.trim()) replaceLastToken(draft.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Fix the last word"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sb-panel w-full max-w-lg rounded-[var(--radius-panel)] p-5 shadow-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">Fix the last word</h2>
        <p className="mt-1 text-sm text-[var(--sb-fg-muted)]">
          {last ? (
            <>
              Recognised as <span className="font-semibold text-[var(--sb-fg)]">{last.text}</span> at{' '}
              {Math.round(last.confidence * 100)}% confidence.
            </>
          ) : (
            'Nothing has been recognised yet.'
          )}
        </p>

        <label className="mt-4 block text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
          Correct text
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') onClose();
            }}
            className="mt-1.5 w-full rounded-xl border border-[var(--sb-panel-edge)] bg-transparent px-3 py-2.5 font-[family-name:var(--font-display)] text-lg font-semibold normal-case tracking-normal outline-none focus:border-[var(--color-signal)]"
          />
        </label>

        {topLetters.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
              What the model saw on the last frame
            </p>
            <ul className="mt-2 space-y-1.5">
              {topLetters.map(([letter, p]) => (
                <li key={letter} className="flex items-center gap-3 text-sm">
                  <span className="w-6 font-[family-name:var(--font-display)] text-base font-bold">
                    {letter}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--sb-panel-edge)]">
                    <span
                      className="block h-full rounded-full bg-[var(--color-signal)]"
                      style={{ width: `${Math.round(p * 100)}%` }}
                    />
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-[var(--sb-fg-muted)]">
                    {Math.round(p * 100)}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-[var(--sb-fg-muted)]">
              {letterHint(topLetters[0][0])}
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--sb-fg-muted)] hover:text-[var(--sb-fg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            className="rounded-xl bg-[var(--color-signal)] px-4 py-2 text-sm font-semibold text-[#1a1200] hover:brightness-110"
          >
            Save correction
          </button>
        </div>
      </div>
    </div>
  );
}
