/**
 * Model loading, with integrity checking and honest absence.
 *
 * Every shipped model is declared in /public/models/manifest.json alongside a
 * SHA-256 of the .onnx file and a pointer to its model card. If the manifest is
 * missing, or an entry's hash does not match, the model is not loaded and the
 * app says so in plain language rather than silently running an unknown blob or
 * pretending the feature works.
 *
 * The repository ships with no trained models. That is deliberate: shipping an
 * untrained placeholder that "recognises" things would be the exact overclaim
 * this project is supposed to avoid.
 */
import type * as ORT from 'onnxruntime-web';
import { configureRuntime, executionProviders, ort, resolveBackend } from './backend';
import type { Backend } from '@/settings/schema';

export interface ModelEntry {
  id: string;
  /** Path relative to the site root. */
  file: string;
  sha256: string;
  labels: string[];
  inputName: string;
  outputName: string;
  /** Expected flat input length, checked before every run. */
  inputDim: number;
  /** Path to this model's card in /docs. */
  card: string;
  version: string;
}

export interface ModelManifest {
  version: number;
  models: ModelEntry[];
}

export type ModelStatus =
  | { state: 'absent'; reason: string }
  | { state: 'loading' }
  | { state: 'ready'; entry: ModelEntry; backend: string }
  | { state: 'failed'; reason: string };

const MANIFEST_URL = '/models/manifest.json';

let manifestPromise: Promise<ModelManifest | null> | null = null;

export function loadManifest(): Promise<ModelManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((r) => (r.ok ? (r.json() as Promise<ModelManifest>) : null))
      .catch(() => null);
  }
  return manifestPromise;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface LoadedModel {
  entry: ModelEntry;
  session: ORT.InferenceSession;
  backend: string;
  run(features: Float32Array): Promise<Float32Array>;
  dispose(): Promise<void>;
}

export async function loadModel(id: string, preference: Backend = 'auto'): Promise<LoadedModel> {
  const manifest = await loadManifest();
  if (!manifest) {
    throw new Error(
      'No model manifest is present. SignBridge is running on its built-in geometric baseline.',
    );
  }
  const entry = manifest.models.find((m) => m.id === id);
  if (!entry) throw new Error(`No model named "${id}" is listed in the manifest.`);

  const response = await fetch(entry.file);
  if (!response.ok) throw new Error(`Could not download ${entry.file} (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();

  const actual = await sha256Hex(bytes);
  if (entry.sha256 && actual !== entry.sha256) {
    throw new Error(
      `Model ${id} failed its integrity check. Expected ${entry.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…. Refusing to load it.`,
    );
  }

  await configureRuntime();
  const runtime = await ort();
  const backend = await resolveBackend(preference);
  const session = await runtime.InferenceSession.create(bytes, {
    executionProviders: executionProviders(backend),
    graphOptimizationLevel: 'all',
  });

  // Warm-up run: the first inference on WebGPU/WASM compiles kernels and can
  // take 100x the steady-state time. Paying that now keeps the first real
  // caption from arriving half a second late.
  const warm = new Float32Array(entry.inputDim);
  await runSession(session, entry, warm).catch(() => undefined);

  return {
    entry,
    session,
    backend,
    run: (features) => runSession(session, entry, features),
    dispose: async () => {
      await session.release();
    },
  };
}

async function runSession(
  session: ORT.InferenceSession,
  entry: ModelEntry,
  features: Float32Array,
): Promise<Float32Array> {
  if (features.length !== entry.inputDim) {
    throw new Error(
      `Model ${entry.id} expects ${entry.inputDim} inputs, got ${features.length}. The feature pipeline and the model are out of sync.`,
    );
  }
  const runtime = await ort();
  const tensor = new runtime.Tensor('float32', features, [1, entry.inputDim]);
  const output = await session.run({ [entry.inputName]: tensor });
  const raw = output[entry.outputName]?.data as Float32Array | undefined;
  if (!raw) throw new Error(`Model ${entry.id} produced no "${entry.outputName}" output.`);
  return softmaxInPlace(Float32Array.from(raw));
}

function softmaxInPlace(logits: Float32Array): Float32Array {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    logits[i] = Math.exp(logits[i] - max);
    sum += logits[i];
  }
  if (sum > 0) for (let i = 0; i < logits.length; i++) logits[i] /= sum;
  return logits;
}
