/**
 * Forward migration of persisted settings.
 *
 * Each step takes the shape at version N and returns the shape at N+1. Steps
 * never look at the current schema types - they operate on plain records - so
 * that renaming a field today does not silently break a migration written a
 * year ago.
 */
import type { Settings } from './schema';
import { SETTINGS_VERSION } from './schema';
import { DEFAULT_SETTINGS } from './defaults';

type Blob = Record<string, unknown>;

const STEPS: Record<number, (s: Blob) => Blob> = {
  // v1 -> v2: split the single `speech` group into input and output.
  1: (s) => {
    const speech = (s.speech as Blob) ?? {};
    const { speech: _drop, ...rest } = s;
    void _drop;
    return {
      ...rest,
      speechOut: {
        readAloud: speech.readAloud ?? 'word',
        voiceURI: speech.voiceURI ?? null,
        rate: speech.rate ?? 1,
        pitch: speech.pitch ?? 1,
        volume: speech.volume ?? 1,
        onlyAboveThreshold: speech.onlyAboveThreshold ?? true,
        punctuationInference: false,
      },
      speechIn: { deviceId: null, language: 'en-US', pushToTalk: true, interimResults: true },
      version: 2,
    };
  },
  // v2 -> v3: experimental flags moved out of `display` into their own group.
  2: (s) => {
    const display = (s.display as Blob) ?? {};
    const { conversationMode, avatarOutput, ...cleanDisplay } = display;
    return {
      ...s,
      display: cleanDisplay,
      experimental: {
        conversationMode: Boolean(conversationMode),
        avatarOutput: Boolean(avatarOutput),
      },
      version: 3,
    };
  },
};

/** Recursively fill in anything the stored blob is missing. */
function withDefaults<T>(stored: unknown, defaults: T): T {
  if (stored === null || stored === undefined) return structuredClone(defaults);
  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    return typeof stored === typeof defaults ? (stored as T) : structuredClone(defaults);
  }
  if (typeof stored !== 'object' || Array.isArray(stored)) return structuredClone(defaults);

  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(defaults as Record<string, unknown>)) {
    out[key] = withDefaults(
      (stored as Record<string, unknown>)[key],
      (defaults as Record<string, unknown>)[key],
    );
  }
  return out as T;
}

export function migrateSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_SETTINGS);

  let blob = stored as Blob;
  let version = typeof blob.version === 'number' ? blob.version : 1;

  while (version < SETTINGS_VERSION) {
    const step = STEPS[version];
    if (!step) {
      // No path forward from this version. Keep what we can rather than
      // discarding the user's whole configuration.
      break;
    }
    blob = step(blob);
    version = typeof blob.version === 'number' ? blob.version : version + 1;
  }

  const merged = withDefaults(blob, DEFAULT_SETTINGS);
  merged.version = SETTINGS_VERSION;
  // Privacy is not negotiable through a stale blob.
  merged.privacy.onDeviceOnly = true;
  return merged;
}
