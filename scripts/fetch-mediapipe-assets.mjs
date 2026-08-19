/**
 * Vendors the MediaPipe wasm runtime and .task model files into /public so the
 * app can run fully offline and never reaches a CDN at runtime.
 *
 * wasm  -> copied from node_modules (shipped with @mediapipe/tasks-vision)
 * .task -> downloaded once from Google's model storage
 *
 * Re-run with `npm run fetch:models`. Safe to run repeatedly; existing files
 * with a matching byte length are left alone.
 */
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmOut = join(root, 'public', 'mediapipe', 'wasm');
const modelOut = join(root, 'public', 'mediapipe', 'models');

const MODELS = [
  {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  },
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
  },
];

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function copyWasm() {
  const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  await mkdir(wasmOut, { recursive: true });
  await cp(src, wasmOut, { recursive: true });
  console.log(`wasm  ok  ${src} -> public/mediapipe/wasm`);
}

async function fetchModels() {
  await mkdir(modelOut, { recursive: true });
  let failed = 0;
  for (const m of MODELS) {
    const dest = join(modelOut, m.file);
    if (await exists(dest)) {
      console.log(`model ok  ${m.file} (cached)`);
      continue;
    }
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      console.log(`model ok  ${m.file} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    } catch (err) {
      failed++;
      console.warn(`model FAIL ${m.file}: ${err.message}`);
    }
  }
  if (failed) {
    console.warn(
      `\n${failed} model(s) missing. The app falls back to the MediaPipe CDN at ` +
        `runtime, which breaks offline mode. Re-run "npm run fetch:models" when online.`,
    );
  }
}

await copyWasm();
await fetchModels();
