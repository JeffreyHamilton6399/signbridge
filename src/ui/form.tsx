/**
 * Form primitives.
 *
 * Every control here is labelled, keyboard reachable, and shows a visible focus
 * ring. Slider values are announced as text as well as drawn, because a slider
 * whose value only exists visually is not usable with a screen reader.
 */
import type { ReactNode } from 'react';
import { useId } from 'react';

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--sb-panel-edge)] py-5 first:border-t-0 first:pt-0">
      <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">{title}</h3>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-[var(--sb-fg-muted)]">{description}</p>
      )}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
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
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-35 ${
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

export function Select({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
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
        onChange={(e) => onChange(e.target.value)}
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
        className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
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
