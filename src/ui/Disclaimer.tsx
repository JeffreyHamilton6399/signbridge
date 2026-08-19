/**
 * The disclaimer. It does not dismiss, it does not collapse, it does not fade.
 *
 * SignBridge is a recognition assistant. It is not an interpreter, and the word
 * "interpreter" is never used for the software anywhere in this app. If you are
 * about to add a close button to this component, the answer is no - the whole
 * point is that somebody handed this screen in a hospital waiting room reads it
 * without having to look for it.
 */
export function Disclaimer() {
  return (
    <div
      role="note"
      className="pointer-events-none z-40 flex w-full justify-center px-3 pt-[env(safe-area-inset-top)]"
    >
      <p className="sb-panel mt-2 rounded-full px-4 py-1.5 text-center text-[11px] leading-snug font-medium tracking-wide sm:text-xs">
        <span className="text-[var(--color-signal)]">Recognition assistant, not an interpreter.</span>{' '}
        <span className="text-[var(--sb-fg-muted)]">
          Do not rely on it for medical, legal, emergency, financial or educational-access
          conversations.
        </span>
      </p>
    </div>
  );
}

/** Longer form, shown in onboarding and in Settings > About. */
export function DisclaimerLong() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[var(--sb-fg-muted)]">
      <p>
        <strong className="text-[var(--sb-fg)]">What this is.</strong> A tool that watches your
        camera and guesses at American Sign Language handshapes. It gets things wrong, often, and
        it shows you how confident it is so you can catch it.
      </p>
      <p>
        <strong className="text-[var(--sb-fg)]">What this is not.</strong> An interpreter. A
        certified interpreter is a qualified professional who conveys meaning, register, and intent
        between two languages and two cultures. This is pattern matching on hand positions. Using
        it in place of an interpreter in medical, legal, emergency, financial or
        educational-accommodation settings can cause real harm, and in many places it does not
        satisfy an accessibility obligation either.
      </p>
      <p>
        <strong className="text-[var(--sb-fg)]">ASL is a language.</strong> It has its own grammar,
        spatial syntax, and non-manual markers - facial expression, eyebrow position, head tilt,
        mouth morphemes - that carry meaning this app largely cannot see. Signing one sign per
        English word is not ASL, and any output here that looks like a fluent English sentence has
        been through a translation step that is approximate by nature.
      </p>
      <p>
        <strong className="text-[var(--sb-fg)]">Built by hearing developers.</strong> That is a
        known problem, not a footnote. Deaf signers should be testing and shaping this before it is
        put in front of anyone as a product. There is a feedback link in Settings and it goes
        somewhere real.
      </p>
    </div>
  );
}
