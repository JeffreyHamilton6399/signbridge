/**
 * Captions.
 *
 * The camera view is the document, so captions are typography laid over live
 * video the way subtitles live on film - not a chat log in a panel underneath.
 *
 * Confidence is encoded in the type itself. A letter still being formed renders
 * light, wide-tracked and dim; as its dwell timer fills it gains weight and
 * closes up; on commit it snaps into place. That transition happens hundreds of
 * times a session and is the thing people remember, so it gets the animation
 * budget. It is also functional: you can read the model's uncertainty without
 * looking away from the video at a separate widget.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession, useSettings } from '@/store';
import { CAPTION_SIZE_PX } from '@/settings/schema';

export function Captions() {
  const tokens = useSession((s) => s.tokens);
  const buffer = useSession((s) => s.buffer);
  const tentative = useSession((s) => s.tentative);
  const display = useSettings((s) => s.settings.display);
  const mode = useSettings((s) => s.settings.recognition.mode);
  const scrollRef = useRef<HTMLDivElement>(null);

  const size = CAPTION_SIZE_PX[display.captionSize];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tokens.length, buffer]);

  const position =
    display.captionPosition === 'top'
      ? 'top-16 bottom-auto'
      : display.captionPosition === 'side'
        ? 'top-16 bottom-24 right-0 left-auto w-[min(38ch,42vw)]'
        : // Clears the control bar; captions must never sit under the buttons.
          'bottom-24 short:bottom-16 top-auto';

  return (
    <div
      className={`sb-on-video pointer-events-none absolute ${display.captionPosition === 'side' ? '' : 'inset-x-0'} ${position} z-20 flex justify-center`}
    >
      <div
        ref={scrollRef}
        className="sb-scroll sb-caption-band max-h-[38vh] w-full max-w-5xl overflow-y-auto px-3 pb-2 sm:px-5"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Recognised text"
      >
        <p
          className="text-balance leading-[1.12] font-[family-name:var(--font-display)]"
          style={{
            // Scale with the viewport, never exceeding the chosen size. Without
            // this, "Large" captions are unreadable on a phone.
            fontSize: `min(${size}px, 9vw)`,
            textShadow: 'var(--sb-caption-shadow)',
          }}
        >
          {tokens.map((token) => (
            <CommittedToken key={token.id} text={token.text} confidence={token.confidence} corrected={token.corrected} />
          ))}
          {buffer && <BufferedLetters letters={buffer} />}
          {tentative && (
            <TentativeGlyph
              label={tentative.label}
              progress={tentative.progress}
              confidence={tentative.confidence}
            />
          )}
          {tokens.length === 0 && !buffer && !tentative && (
            <span className="text-[0.42em] font-[family-name:var(--font-ui)] font-medium text-[var(--sb-fg-muted)]">
              {mode === 'signs'
                ? 'Sign to start. Recognised signs appear here.'
                : 'Sign to start. Recognised letters appear here.'}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function CommittedToken({
  text,
  confidence,
  corrected,
}: {
  text: string;
  confidence: number;
  corrected?: boolean;
}) {
  // Committed words stay legible regardless of confidence - they are already
  // in the transcript. A low-confidence word is marked with an underline
  // instead of being dimmed, so it can still be read at a distance.
  const uncertain = !corrected && confidence < 0.7;
  return (
    <span
      className="sb-glyph"
      style={{
        ['--sb-wght' as string]: '700',
        textDecoration: uncertain ? 'underline' : undefined,
        textDecorationStyle: 'dotted',
        textDecorationColor: 'var(--color-alert)',
        textUnderlineOffset: '0.14em',
      }}
      title={uncertain ? `Low confidence (${Math.round(confidence * 100)}%)` : undefined}
    >
      {text}{' '}
    </span>
  );
}

function BufferedLetters({ letters }: { letters: string }) {
  const [lastLength, setLastLength] = useState(letters.length);
  useEffect(() => setLastLength(letters.length), [letters.length]);
  const grew = letters.length > lastLength;

  return (
    <span>
      {[...letters].map((letter, i) => (
        <span
          key={`${i}-${letter}`}
          className={`sb-glyph ${grew && i === letters.length - 1 ? 'sb-glyph--commit' : ''}`}
          style={{ ['--sb-wght' as string]: '700' }}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

function TentativeGlyph({
  label,
  progress,
  confidence,
}: {
  label: string;
  progress: number;
  confidence: number;
}) {
  // Weight and tracking resolve together as the dwell timer fills: 300 -> 700
  // weight, 0.09em -> 0em tracking, 0.45 -> 1 opacity.
  const weight = Math.round(300 + progress * 400);
  return (
    <span
      className="sb-glyph sb-glyph--tentative"
      style={{
        ['--sb-wght' as string]: String(weight),
        opacity: 0.45 + progress * 0.55,
        letterSpacing: `${(0.09 * (1 - progress)).toFixed(3)}em`,
      }}
      title={`${label} — ${Math.round(confidence * 100)}% confident, holding`}
    >
      {label}
    </span>
  );
}
