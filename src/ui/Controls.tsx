/**
 * The control bar.
 *
 * Lives at the extreme bottom edge, out of the centre of frame where hands
 * actually are. Everything here is reachable by keyboard and named by what it
 * does to the text, not by what it does to the model.
 */
import { useSession, useSettings } from '@/store';

export function SuggestionStrip({ onAccept }: { onAccept(word: string): void }) {
  const suggestions = useSession((s) => s.suggestions);
  const enabled = useSettings((s) => s.settings.recognition.wordPrediction);
  if (!enabled || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Word suggestions">
      {suggestions.map((s) => (
        <button
          key={s.word}
          type="button"
          onClick={() => onAccept(s.word)}
          className="sb-panel rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:border-[var(--color-signal)]"
        >
          {s.word}
          {s.corrected && (
            <span
              className="ml-1.5 text-[10px] text-[var(--color-signal)]"
              title="Assumes one letter was misread"
            >
              fix?
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export interface ControlsProps {
  onBackspace(): void;
  onSpace(): void;
  onClear(): void;
  onSpeak(): void;
  onCorrect(): void;
  onExport(): void;
}

export function Controls(props: ControlsProps) {
  const hasText = useSession((s) => s.tokens.length > 0 || s.buffer.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ControlButton label="Backspace" onClick={props.onBackspace} shortcut="Backspace">
        <PathIcon d="M20 6H9l-5 6 5 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Zm-6 3 4 4m0-4-4 4" />
      </ControlButton>
      <ControlButton label="Space" onClick={props.onSpace} shortcut="Space">
        <PathIcon d="M5 10v4h14v-4" />
      </ControlButton>
      <ControlButton label="Fix last word" onClick={props.onCorrect} disabled={!hasText} shortcut="F">
        <PathIcon d="M4 20h4l10-10-4-4L4 16v4Zm10-14 4 4" />
      </ControlButton>
      <ControlButton label="Read aloud" onClick={props.onSpeak} disabled={!hasText} shortcut="R">
        <PathIcon d="M11 5 6 9H3v6h3l5 4V5Zm4 2a6 6 0 0 1 0 10m2.5-13a10 10 0 0 1 0 16" />
      </ControlButton>
      <ControlButton label="Export" onClick={props.onExport} disabled={!hasText} shortcut="E">
        <PathIcon d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3" />
      </ControlButton>
      <ControlButton label="Clear" onClick={props.onClear} disabled={!hasText} destructive>
        <PathIcon d="M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
  disabled,
  destructive,
  shortcut,
}: {
  label: string;
  onClick(): void;
  children: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-keyshortcuts={shortcut}
      className={`sb-panel group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all disabled:opacity-35 ${
        destructive ? 'hover:border-[var(--color-alert)]' : 'hover:border-[var(--color-signal)]'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      <span className="hidden sm:inline short:hidden">{label}</span>
    </button>
  );
}

function PathIcon({ d }: { d: string }) {
  return <path d={d} />;
}
