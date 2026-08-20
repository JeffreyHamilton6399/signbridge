/**
 * Conversation mode - continuous signing to English. Experimental, and it says so.
 *
 * The pipeline is real: windowed landmark features feed a temporal encoder,
 * whose per-frame logits are CTC-decoded into a gloss sequence, which is then
 * translated to English. What is missing is the trained encoder, and that is not
 * a small gap - continuous ASL recognition is an open research problem and
 * published systems score well below usable accuracy on unconstrained input.
 *
 * So this screen does the one thing it can do honestly: it shows the decoded
 * gloss stream from whatever model is loaded, refuses to invent one, and fails
 * visibly rather than confidently.
 */
import { useEffect, useState } from 'react';
import { loadManifest } from '@/models/registry';
import { glossToEnglish } from './glossToEnglish';
import { useSession } from '@/store';

export function ConversationMode() {
  const [hasModel, setHasModel] = useState<boolean | null>(null);
  const tokens = useSession((s) => s.tokens);

  useEffect(() => {
    void loadManifest().then((m) => {
      setHasModel(Boolean(m?.models.some((entry) => entry.id === 'conversation-ctc')));
    });
  }, []);

  const english = glossToEnglish(tokens.map((t) => ({ gloss: t.text, confidence: t.confidence })));

  return (
    <div className="sb-scroll h-full overflow-y-auto px-4 pt-28 pb-32 sm:pt-16">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Conversation</h1>
          <span className="rounded-full border border-[var(--color-alert)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-alert)]">
            Experimental
          </span>
        </header>

        <div className="mt-4 rounded-2xl border border-[var(--color-alert)] p-4">
          <h2 className="text-sm font-semibold text-[var(--color-alert)]">
            Expect this to fail
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
            Continuous ASL recognition is an open research problem. Sentence-level systems in the
            literature score well below usable accuracy on unconstrained signing, and this app has no
            advantage over them. On short, clear, in-vocabulary sentences you may get something
            recognisable. On anything else it should visibly produce nothing rather than a confident
            guess — if you see it producing fluent English from signing it cannot have understood,
            that is a bug worth reporting.
          </p>
        </div>

        {hasModel === false && (
          <div className="mt-5 rounded-2xl border border-[var(--sb-panel-edge)] p-4">
            <h2 className="text-sm font-semibold">No continuous model is installed</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
              This build ships without a trained temporal encoder, so there is nothing to decode.
              The CTC decoder, the feature pipeline and this screen are in place; training one needs
              an aligned continuous corpus such as How2Sign or OpenASL, and a model card in{' '}
              <code className="font-mono">docs/MODELS.md</code> before it ships. See{' '}
              <code className="font-mono">training/README.md</code>.
            </p>
          </div>
        )}

        {tokens.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
              Decoded gloss
            </h2>
            <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold">
              {tokens.map((t) => t.text).join(' ')}
            </p>

            <h2 className="mt-5 text-xs font-semibold tracking-wide uppercase text-[var(--sb-fg-muted)]">
              Approximate English
            </h2>
            <p className="mt-2 text-xl leading-snug">{english.text}</p>
            <p className="mt-1.5 text-xs text-[var(--sb-fg-muted)]">
              Rule-based gloss-to-English. Lowest contributing confidence:{' '}
              {Math.round(english.confidence * 100)}%.{' '}
              {english.literal && 'No grammatical restructuring was possible — this is close to a literal reading.'}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
