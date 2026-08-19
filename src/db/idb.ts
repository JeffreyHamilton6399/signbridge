/**
 * Local storage. All of it.
 *
 * Nothing in this file ever talks to a network. Settings, calibration samples,
 * custom signs and transcripts live in IndexedDB on the user's device, and the
 * "Delete all data" control in Settings clears the whole database. That promise
 * is only as good as this file, so keep it boring.
 */
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Settings } from '@/settings/schema';
import type { CalibrationSample, LinearHead } from '@/modes/fingerspell/calibration';

export interface StoredCalibration {
  id: 'fingerspell';
  samples: { label: string; features: number[]; t: number }[];
  head: {
    labels: string[];
    weights: number[];
    bias: number[];
    trainAccuracy: number;
    version: number;
    updatedAt: number;
  } | null;
  updatedAt: number;
}

export interface CustomSign {
  id: string;
  label: string;
  /** Few-shot examples: each is a flattened window of landmark features. */
  samples: number[][];
  /** Elementwise mean of `samples`, cached so recognition does not recompute. */
  centroid: number[];
  featureDim: number;
  frames: number;
  createdAt: number;
  updatedAt: number;
}

export interface TranscriptEntry {
  id: string;
  startedAt: number;
  endedAt: number;
  mode: string;
  text: string;
  /** Per-token confidence, aligned to whitespace-separated tokens in `text`. */
  confidences: number[];
}

interface SignBridgeDB extends DBSchema {
  settings: { key: string; value: Settings };
  calibration: { key: string; value: StoredCalibration };
  customSigns: { key: string; value: CustomSign; indexes: { 'by-label': string } };
  transcripts: { key: string; value: TranscriptEntry; indexes: { 'by-date': number } };
  vocabulary: { key: string; value: { id: string; words: Record<string, number> } };
}

const DB_NAME = 'signbridge';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SignBridgeDB>> | null = null;

export function db(): Promise<IDBPDatabase<SignBridgeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SignBridgeDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings');
        }
        if (!database.objectStoreNames.contains('calibration')) {
          database.createObjectStore('calibration', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('customSigns')) {
          const store = database.createObjectStore('customSigns', { keyPath: 'id' });
          store.createIndex('by-label', 'label');
        }
        if (!database.objectStoreNames.contains('transcripts')) {
          const store = database.createObjectStore('transcripts', { keyPath: 'id' });
          store.createIndex('by-date', 'startedAt');
        }
        if (!database.objectStoreNames.contains('vocabulary')) {
          database.createObjectStore('vocabulary', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** IndexedDB is unavailable in private windows on some browsers. Degrade quietly. */
export async function safely<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch (err) {
    console.warn('IndexedDB unavailable, running without persistence:', err);
    return fallback;
  }
}

// --- settings --------------------------------------------------------------

export async function loadSettingsBlob(): Promise<unknown> {
  return safely(async () => (await db()).get('settings', 'current'), null);
}

export async function saveSettingsBlob(settings: Settings): Promise<void> {
  await safely(async () => {
    await (await db()).put('settings', settings, 'current');
  }, undefined);
}

// --- calibration -----------------------------------------------------------

export async function loadCalibration(): Promise<{
  samples: CalibrationSample[];
  head: LinearHead | null;
} | null> {
  return safely(async () => {
    const row = await (await db()).get('calibration', 'fingerspell');
    if (!row) return null;
    return {
      samples: row.samples.map((s) => ({
        label: s.label,
        features: Float32Array.from(s.features),
        t: s.t,
      })),
      head: row.head
        ? {
            version: row.head.version,
            labels: row.head.labels,
            weights: Float32Array.from(row.head.weights),
            bias: Float32Array.from(row.head.bias),
            trainAccuracy: row.head.trainAccuracy,
            updatedAt: row.head.updatedAt,
          }
        : null,
    };
  }, null);
}

export async function saveCalibration(
  samples: readonly CalibrationSample[],
  head: LinearHead | null,
): Promise<void> {
  await safely(async () => {
    const row: StoredCalibration = {
      id: 'fingerspell',
      samples: samples.map((s) => ({ label: s.label, features: [...s.features], t: s.t })),
      head: head
        ? {
            labels: head.labels,
            weights: [...head.weights],
            bias: [...head.bias],
            trainAccuracy: head.trainAccuracy,
            version: head.version,
            updatedAt: head.updatedAt,
          }
        : null,
      updatedAt: Date.now(),
    };
    await (await db()).put('calibration', row);
  }, undefined);
}

export async function clearCalibration(): Promise<void> {
  await safely(async () => {
    await (await db()).delete('calibration', 'fingerspell');
  }, undefined);
}

// --- custom signs ----------------------------------------------------------

export async function listCustomSigns(): Promise<CustomSign[]> {
  return safely(async () => (await db()).getAll('customSigns'), []);
}

export async function putCustomSign(sign: CustomSign): Promise<void> {
  await safely(async () => {
    await (await db()).put('customSigns', sign);
  }, undefined);
}

export async function deleteCustomSign(id: string): Promise<void> {
  await safely(async () => {
    await (await db()).delete('customSigns', id);
  }, undefined);
}

// --- transcripts -----------------------------------------------------------

export async function saveTranscript(entry: TranscriptEntry): Promise<void> {
  await safely(async () => {
    await (await db()).put('transcripts', entry);
  }, undefined);
}

export async function listTranscripts(): Promise<TranscriptEntry[]> {
  return safely(async () => {
    const all = await (await db()).getAll('transcripts');
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }, []);
}

export async function deleteTranscript(id: string): Promise<void> {
  await safely(async () => {
    await (await db()).delete('transcripts', id);
  }, undefined);
}

/** Enforce the user's retention window. Called once on startup. */
export async function pruneTranscripts(olderThanDays: number): Promise<number> {
  if (olderThanDays <= 0) return 0;
  return safely(async () => {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    const database = await db();
    const tx = database.transaction('transcripts', 'readwrite');
    let removed = 0;
    for await (const cursor of tx.store.index('by-date').iterate()) {
      if (cursor.value.startedAt < cutoff) {
        await cursor.delete();
        removed++;
      }
    }
    await tx.done;
    return removed;
  }, 0);
}

// --- learned vocabulary ----------------------------------------------------

export async function loadUserWords(): Promise<Record<string, number>> {
  return safely(async () => {
    const row = await (await db()).get('vocabulary', 'user');
    return row?.words ?? {};
  }, {});
}

export async function saveUserWords(words: Record<string, number>): Promise<void> {
  await safely(async () => {
    await (await db()).put('vocabulary', { id: 'user', words });
  }, undefined);
}

// --- bulk export / delete --------------------------------------------------

export interface ExportBundle {
  exportedAt: string;
  app: 'signbridge';
  settings: unknown;
  calibration: unknown;
  customSigns: unknown;
  transcripts: unknown;
  vocabulary: unknown;
}

export async function exportAll(): Promise<ExportBundle> {
  return safely<ExportBundle>(
    async () => {
      const database = await db();
      return {
        exportedAt: new Date().toISOString(),
        app: 'signbridge' as const,
        settings: (await database.get('settings', 'current')) ?? null,
        calibration: (await database.get('calibration', 'fingerspell')) ?? null,
        customSigns: await database.getAll('customSigns'),
        transcripts: await database.getAll('transcripts'),
        vocabulary: await database.getAll('vocabulary'),
      };
    },
    {
      exportedAt: new Date().toISOString(),
      app: 'signbridge' as const,
      settings: null,
      calibration: null,
      customSigns: [],
      transcripts: [],
      vocabulary: [],
    },
  );
}

export async function deleteAllData(): Promise<void> {
  await safely(async () => {
    const database = await db();
    await Promise.all([
      database.clear('settings'),
      database.clear('calibration'),
      database.clear('customSigns'),
      database.clear('transcripts'),
      database.clear('vocabulary'),
    ]);
  }, undefined);
}
