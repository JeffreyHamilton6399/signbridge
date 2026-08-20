/**
 * Application state.
 *
 * Two slices with very different lifetimes:
 *   - settings: persisted, migrated, rarely written
 *   - session:  everything about the current run, written at frame rate
 *
 * The frame-rate data (current prediction, confidence, landmark frame) lives in
 * a separate store so a caption re-render never re-renders the settings panel.
 */
import { create } from 'zustand';
import type { Settings } from '@/settings/schema';
import { freshSettings } from '@/settings/defaults';
import { migrateSettings } from '@/settings/migrate';
import { loadSettingsBlob, saveSettingsBlob } from '@/db/idb';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  hydrate(): Promise<void>;
  patch(update: DeepPartial<Settings>): void;
  resetToDefaults(): void;
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current, value as DeepPartial<typeof current>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: freshSettings(),
  loaded: false,

  async hydrate() {
    const stored = await loadSettingsBlob();
    set({ settings: migrateSettings(stored ?? get().settings), loaded: true });
  },

  patch(update) {
    const next = deepMerge(get().settings, update);
    // onDeviceOnly is not user-writable; the UI shows it locked and this
    // enforces it even if something else tries to patch it.
    next.privacy.onDeviceOnly = true;
    set({ settings: next });
    void saveSettingsBlob(next);
  },

  resetToDefaults() {
    const next = freshSettings();
    // Keep the fact that they have been onboarded; resetting settings should
    // not re-run the permission explainer.
    next.onboardingComplete = get().settings.onboardingComplete;
    set({ settings: next });
    void saveSettingsBlob(next);
  },
}));

// ---------------------------------------------------------------------------

export interface Token {
  text: string;
  confidence: number;
  /** Monotonic id so React keys stay stable through edits. */
  id: number;
  /** True for a token the user picked or typed rather than one recognised. */
  corrected?: boolean;
}

export type Pipeline = 'idle' | 'starting' | 'running' | 'error';

interface SessionState {
  pipeline: Pipeline;
  error: { message: string; remedy: string } | null;
  delegate: 'GPU' | 'CPU' | null;
  /** Whether landmarking runs in a worker or on the main thread. */
  visionMode: 'worker' | 'inline' | null;
  fps: number;
  inferenceMs: number;
  latencyMs: number;

  /** The letter or word currently being held, before it commits. */
  tentative: { label: string; confidence: number; progress: number } | null;
  alternates: { label: string; confidence: number }[];
  distribution: Record<string, number>;

  /** Committed output for the current session. */
  tokens: Token[];
  /** Letters accumulated toward the current word, fingerspell mode only. */
  buffer: string;
  suggestions: { word: string; corrected: boolean }[];

  startedAt: number;

  setPipeline(p: Pipeline, error?: { message: string; remedy: string } | null): void;
  setStats(
    s: Partial<Pick<SessionState, 'fps' | 'inferenceMs' | 'latencyMs' | 'delegate' | 'visionMode'>>,
  ): void;
  setTentative(t: SessionState['tentative']): void;
  setAlternates(a: SessionState['alternates'], distribution?: Record<string, number>): void;
  setSuggestions(s: SessionState['suggestions']): void;

  appendLetter(letter: string, confidence: number): void;
  commitWord(word?: string, confidence?: number): void;
  pushToken(text: string, confidence: number, corrected?: boolean): void;
  backspace(): void;
  replaceLastToken(text: string): void;
  clearAll(): void;

  get text(): string;
}

let tokenId = 0;

export const useSession = create<SessionState>((set, get) => ({
  pipeline: 'idle',
  error: null,
  delegate: null,
  visionMode: null,
  fps: 0,
  inferenceMs: 0,
  latencyMs: 0,

  tentative: null,
  alternates: [],
  distribution: {},

  tokens: [],
  buffer: '',
  suggestions: [],

  startedAt: Date.now(),

  setPipeline(pipeline, error = null) {
    set({ pipeline, error });
  },
  setStats(stats) {
    set(stats);
  },
  setTentative(tentative) {
    set({ tentative });
  },
  setAlternates(alternates, distribution) {
    set(distribution ? { alternates, distribution } : { alternates });
  },
  setSuggestions(suggestions) {
    set({ suggestions });
  },

  appendLetter(letter, _confidence) {
    void _confidence;
    set({ buffer: get().buffer + letter, tentative: null });
  },

  commitWord(word, confidence = 1) {
    const text = (word ?? get().buffer).trim();
    if (!text) {
      set({ buffer: '' });
      return;
    }
    set({
      tokens: [...get().tokens, { text, confidence, id: tokenId++, corrected: word !== undefined }],
      buffer: '',
      suggestions: [],
    });
  },

  pushToken(text, confidence, corrected = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    set({ tokens: [...get().tokens, { text: trimmed, confidence, id: tokenId++, corrected }] });
  },

  backspace() {
    const { buffer, tokens } = get();
    if (buffer.length > 0) {
      set({ buffer: buffer.slice(0, -1) });
      return;
    }
    if (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      // Pull the last word back into the buffer so a mis-committed word can be
      // fixed letter by letter instead of retyped.
      set({ tokens: tokens.slice(0, -1), buffer: last.text.slice(0, -1) });
    }
  },

  replaceLastToken(text) {
    const tokens = [...get().tokens];
    if (tokens.length === 0) return;
    tokens[tokens.length - 1] = { ...tokens[tokens.length - 1], text, corrected: true, confidence: 1 };
    set({ tokens });
  },

  clearAll() {
    set({ tokens: [], buffer: '', suggestions: [], tentative: null, startedAt: Date.now() });
  },

  get text() {
    const { tokens, buffer } = get();
    return [...tokens.map((t) => t.text), buffer].filter(Boolean).join(' ');
  },
}));

export function sessionText(state: Pick<SessionState, 'tokens' | 'buffer'>): string {
  return [...state.tokens.map((t) => t.text), state.buffer].filter(Boolean).join(' ');
}
