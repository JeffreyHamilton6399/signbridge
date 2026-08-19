/// <reference lib="webworker" />
/**
 * MediaPipe landmark extraction, off the main thread.
 *
 * Everything about this file exists to protect the frame budget. Landmarking is
 * 8-20ms of work per frame; running it on the main thread makes the video
 * element stutter and the commit animation jank. The main thread grabs an
 * ImageBitmap and hands it over; this worker returns 21 points per hand and
 * (optionally) 33 pose points.
 *
 * Backpressure: if a frame arrives while one is in flight it is dropped, not
 * queued. A queued frame produces captions that lag reality, which is worse
 * than missing a frame nobody would have noticed.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { VisionInitOptions, VisionRequest, VisionResponse } from './protocol';
import type { Handedness, Point3, VisionFrame } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let hand: HandLandmarker | null = null;
let pose: PoseLandmarker | null = null;
let options: VisionInitOptions | null = null;
let busy = false;
/** MediaPipe requires strictly increasing timestamps in VIDEO mode. */
let lastTimestamp = -1;

function post(msg: VisionResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function toPoints(landmarks: { x: number; y: number; z: number }[]): Point3[] {
  return landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

/**
 * MediaPipe assets are vendored into /public by `npm run fetch:models` so the
 * app never touches a CDN at runtime. If that step did not run — a deploy where
 * the download failed, say — fall back to the CDN rather than shipping a broken
 * camera. Offline mode is lost in that case, which is why it is a fallback and
 * not the default.
 */
const CDN_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const CDN_MODELS: Record<string, string> = {
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
};

async function resolveAsset(local: string, fallback: string): Promise<string> {
  try {
    const response = await fetch(local, { method: 'HEAD' });
    if (response.ok) return local;
  } catch {
    // Network error on a same-origin HEAD means the file is not there.
  }
  console.warn(`Vendored asset missing at ${local}; falling back to ${fallback}`);
  return fallback;
}

async function build(opts: VisionInitOptions): Promise<void> {
  const localWasm = `${opts.wasmPath}/vision_wasm_internal.js`;
  const wasmPath = (await resolveAsset(localWasm, '')) === localWasm ? opts.wasmPath : CDN_ROOT;
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  const handModelPath = await resolveAsset(opts.handModelPath, CDN_MODELS.hand);
  const poseModelPath = await resolveAsset(opts.poseModelPath, CDN_MODELS.pose);

  const makeHand = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: handModelPath, delegate },
      runningMode: 'VIDEO',
      numHands: opts.numHands,
      minHandDetectionConfidence: opts.minHandDetectionConfidence,
      minHandPresenceConfidence: opts.minHandDetectionConfidence,
      minTrackingConfidence: opts.minTrackingConfidence,
    });

  let delegate = opts.delegate;
  try {
    hand = await makeHand(delegate);
  } catch (err) {
    if (delegate === 'GPU') {
      // Common on Linux/Firefox and in some virtualised GPUs. CPU is slower but
      // always available, and the app stays usable rather than dying.
      console.warn('GPU delegate unavailable, falling back to CPU:', err);
      delegate = 'CPU';
      hand = await makeHand('CPU');
    } else {
      throw err;
    }
  }

  if (opts.trackPose) {
    try {
      pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: poseModelPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: false,
      });
    } catch (err) {
      // Pose is optional: fingerspelling does not need it, so degrade instead
      // of failing the whole pipeline.
      console.warn('Pose landmarker unavailable:', err);
      pose = null;
    }
  } else {
    pose?.close();
    pose = null;
  }

  options = { ...opts, delegate };
  post({ type: 'ready', delegate, poseEnabled: pose !== null });
}

function process(bitmap: ImageBitmap, t: number): void {
  if (!hand) {
    bitmap.close();
    return;
  }
  if (busy) {
    // Drop, do not queue.
    bitmap.close();
    return;
  }
  busy = true;
  const started = performance.now();

  try {
    const timestamp = t <= lastTimestamp ? lastTimestamp + 1 : t;
    lastTimestamp = timestamp;

    const handResult = hand.detectForVideo(bitmap, timestamp);
    const poseResult = pose ? pose.detectForVideo(bitmap, timestamp) : null;

    const frame: VisionFrame = {
      t,
      width: bitmap.width,
      height: bitmap.height,
      hands: handResult.landmarks.map((landmarks, i) => {
        const category = (handResult.handedness ?? handResult.handednesses)?.[i]?.[0];
        return {
          landmarks: toPoints(landmarks),
          // MediaPipe labels handedness as seen in the image. The camera image
          // is not mirrored here (we mirror only for display), so the label is
          // already the physical hand.
          handedness: (category?.categoryName as Handedness) ?? 'Right',
          handednessScore: category?.score ?? 0,
        };
      }),
      pose: poseResult?.landmarks?.[0] ? toPoints(poseResult.landmarks[0]) : null,
    };

    post({ type: 'result', frame, inferenceMs: performance.now() - started });
  } catch (err) {
    post({ type: 'error', message: String(err), fatal: false });
  } finally {
    bitmap.close();
    busy = false;
  }
}

ctx.onmessage = async (event: MessageEvent<VisionRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        await build(msg.options);
        break;
      case 'configure':
        if (options) await build({ ...options, ...msg.options });
        break;
      case 'frame':
        process(msg.bitmap, msg.t);
        break;
      case 'dispose':
        hand?.close();
        pose?.close();
        hand = null;
        pose = null;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: String(err), fatal: true });
  }
};
