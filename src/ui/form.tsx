/**
 * Form primitives.
 *
 * Every control here is labelled, keyboard reachable, and shows a visible focus
 * ring. Slider values are announced as text as well as drawn, because a slider
 * whose value only exists visually is not usable with a screen reader.
 */
import type { ReactNode } from 'react';
import { useId } from 'react';

/**
 * One collapsible group of settings.
 *
 * Settings used to be a single flat scroll of roughly fifty controls. On a
 * phone that is about eight screens of undifferentiated rows, and the effect is
 * that every setting is equally hard to find — including the two or three that
 * actually fix a bad session.
 *
 * Collapsed, a section costs one line and still says what it is currently set
 * to, so the panel opens as a short contents page you can read at a glance. The
 * `summary` is what makes that work: a heading alone tells you where to look,
 * a heading plus "600 ms dwell · calibrated" often means you do not have to.
 */
export function Section({
  title,
  description,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  description?: string;
  /** Current state in a few words, shown while collapsed. */
  summary?: string;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="border-b border-[var(--sb-panel-edge)] last:border-b-0">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center gap-3 py-3.5 text-left"
        >
          <span className="flex-1">
            <span className="block font-[family-name:var(--font-display)] text-base font-bold">
              {title}
            </span>
            {!open && summary && (
              <span className="mt-px block text-xs text-[var(--sb-fg-muted)]">{summary}</span>
            )}
          </span>
          <Chevron open={open} />
        </button>
      </h3>
      {open && (
        <div id={id} className="pb-5">
          {description && (
            <p className="mb-3 text-xs leading-relaxed text-[var(--sb-fg-muted)]">{description}</p>
          )}
          <div className="space-y-4">{children}</div>
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-[var(--sb-fg-muted)] transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * A group of controls that only appears once the user has asked for advanced
 * settings. Rendered as a labelled block rather than mixed in with the
 * essentials, so turning the switch on does not rearrange what was already
 * there — the basics stay exactly where they were and more appears below.
 */
export function Advanced({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <div className="space-y-4 border-l-2 border-[var(--sb-panel-edge)] pl-3">{children}</div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-[var(--sb-fg-muted)]">{hint}</p>}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex-1 cursor-pointer">
        <span className="text-sm font-medium">{label}</span>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-[var(--sb-fg-muted)]">{hint}</p>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
          checked
            ? 'border-[var(--color-signal)] bg-[var(--color-signal)]'
            : 'border-[var(--sb-panel-edge)] bg-transparent'
        }`}
      >
        {/* `left` is explicit: an absolutely positioned span with no inset takes
            its static position from the button's centred text alignment, which
            puts the knob outside the track. */}
        <span
          aria-hidden="true"
          className={`absolute top-[0.1875rem] left-[0.1875rem] h-[1.125rem] w-[1.125rem] rounded-full transition-transform ${
            checked ? 'translate-x-[1.25rem] bg-[#1a1200]' : 'translate-x-0 bg-[var(--sb-fg-muted)]'
          }`}
        />
      </button>
    </div>
  );
}

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-xs font-semibold tabular-nums text-[var(--color-signal)]">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--sb-panel-edge)] accent-[var(--color-signal)]"
      />
      {hint && <p className="text-xs leading-relaxed text-[var(--sb-fg-muted)]">{hint}</p>}
    </div>
  );
}

export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(value: T): void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-10 rounded-lg border px-3.5 text-xs font-medium transition-colors disabled:opacity-35 ${
              value === option.value
                ? 'border-[var(--color-signal)] bg-[color-mix(in_oklab,var(--color-signal)_18%,transparent)] text-[var(--sb-fg)]'
                : 'border-[var(--sb-panel-edge)] text-[var(--sb-fg-muted)] hover:text-[var(--sb-fg)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-2 text-xs leading-relaxed text-[var(--sb-fg-muted)]">{hint}</p>}
    </fieldset>
  );
}

/**
 * Generic in its value so a caller passing a union — 'off' | 'light' | ... —
 * gets that union back in onChange rather than a bare string it would have to
 * cast. The options list is what pins the type parameter.
 */
export function Select<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-xl border border-[var(--sb-panel-edge)] bg-[var(--sb-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-signal)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs leading-relaxed text-[var(--sb-fg-muted)]">{hint}</p>}
    </div>
  );
}

export function ActionRow({
  label,
  hint,
  action,
  onClick,
  destructive,
}: {
  label: string;
  hint?: string;
  action: string;
  onClick(): void;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <span className="text-sm font-medium">{label}</span>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-[var(--sb-fg-muted)]">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`min-h-10 shrink-0 rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
          destructive
            ? 'border-[var(--color-alert)] text-[var(--color-alert)] hover:bg-[color-mix(in_oklab,var(--color-alert)_15%,transparent)]'
            : 'border-[var(--sb-panel-edge)] hover:border-[var(--color-signal)]'
        }`}
      >
        {action}
      </button>
    </div>
  );
}
