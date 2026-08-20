/**
 * The landmarking itself, independent of where it runs.
 *
 * Shared by the Web Worker (the fast path) and the main-thread fallback, so
 * there is exactly one place that knows how to configure MediaPipe and shape a
 * VisionFrame. Nothing in here touches the DOM or `self`.
 *
 * ## The canvas argument is not optional
 *
 * MediaPipe decides for itself whether to trust OffscreenCanvas:
 *
 * ```js
 * function Ph() {
 *   return typeof OffscreenCanvas !== 'undefined'
 *     && (!isSafariAndNotChrome || safariVersion >= 17);
 * }
 * // and then, when no canvas was supplied:
 * canvas ?? (Ph() ? undefined : document.createElement('canvas'))
 * ```
 *
 * On Safari 16 and earlier that check fails, so it reaches for
 * `document.createElement` — which inside a worker throws
 * "ReferenceError: Can't find variable: document" and takes the whole pipeline
 * with it. Passing a canvas explicitly means that branch is never reached, on
 * any browser. Do not make this parameter optional again.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { VisionInitOptions } from './protocol';
import type { Handedness, Point3, VisionFrame } from './types';

/** Anything MediaPipe will accept as a frame source. */
export type FrameSource = ImageBitmap | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas;

export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/**
 * Assets are vendored into /public by `npm run fetch:models` so the app never
 * touches a CDN at runtime. If that step did not run, fall back rather than
 * shipping a broken camera — offline mode is lost, which is why it is a
 * fallback and not the default.
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
    // A failed same-origin HEAD means the file is not there.
  }
  console.warn(`Vendored asset missing at ${local}; falling back to ${fallback}`);
  return fallback;
}

function toPoints(landmarks: { x: number; y: number; z: number }[]): Point3[] {
  return landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

export interface LandmarkerResult {
  frame: VisionFrame;
  inferenceMs: number;
}

export class Landmarker {
  private hand: HandLandmarker;
  private pose: PoseLandmarker | null;
  /** MediaPipe requires strictly increasing timestamps in VIDEO mode. */
  private lastTimestamp = -1;

  readonly delegate: 'GPU' | 'CPU';

  private constructor(hand: HandLandmarker, pose: PoseLandmarker | null, delegate: 'GPU' | 'CPU') {
    this.hand = hand;
    this.pose = pose;
    this.delegate = delegate;
  }

  get poseEnabled(): boolean {
    return this.pose !== null;
  }

  /**
   * @param canvas Required. See the note at the top of this file — passing
   *   undefined lets MediaPipe reach for `document`, which is fatal in a worker.
   * @param useModule true when running as an ES module (Vite builds the worker
   *   that way), where `importScripts` does not exist.
   */
  static async create(
    opts: VisionInitOptions,
    canvas: CanvasLike,
    useModule: boolean,
  ): Promise<Landmarker> {
    const localWasm = `${opts.wasmPath}/vision_wasm_internal.js`;
    const wasmPath = (await resolveAsset(localWasm, '')) === localWasm ? opts.wasmPath : CDN_ROOT;
    const fileset = await FilesetResolver.forVisionTasks(wasmPath, useModule);

    const handModelPath = await resolveAsset(opts.handModelPath, CDN_MODELS.hand);
    const poseModelPath = await resolveAsset(opts.poseModelPath, CDN_MODELS.pose);

    const makeHand = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: handModelPath, delegate },
        canvas,
        runningMode: 'VIDEO',
        numHands: opts.numHands,
        minHandDetectionConfidence: opts.minHandDetectionConfidence,
        minHandPresenceConfidence: opts.minHandDetectionConfidence,
        minTrackingConfidence: opts.minTrackingConfidence,
      });

    let delegate = opts.delegate;
    let hand: HandLandmarker;
    try {
      hand = await makeHand(delegate);
    } catch (err) {
      if (delegate === 'GPU') {
        // Common on Linux/Firefox, in virtualised GPUs, and on Safari, where
        // WebGL on an OffscreenCanvas is unreliable before version 17. CPU is
        // slower but always available.
        console.warn('GPU delegate unavailable, falling back to CPU:', err);
        delegate = 'CPU';
        hand = await makeHand('CPU');
      } else {
        throw err;
      }
    }

    let pose: PoseLandmarker | null = null;
    if (opts.trackPose) {
      try {
        pose = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: poseModelPath, delegate },
          canvas,
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        });
      } catch (err) {
        // Pose is optional: fingerspelling does not need it, so degrade rather
        // than failing the whole pipeline.
        console.warn('Pose landmarker unavailable:', err);
        pose = null;
      }
    }

    return new Landmarker(hand, pose, delegate);
  }

  detect(source: FrameSource, t: number, width: number, height: number): LandmarkerResult {
    const started = performance.now();
    const timestamp = t <= this.lastTimestamp ? this.lastTimestamp + 1 : t;
    this.lastTimestamp = timestamp;

    const handResult = this.hand.detectForVideo(source as never, timestamp);
    const poseResult = this.pose ? this.pose.detectForVideo(source as never, timestamp) : null;

    const frame: VisionFrame = {
      t,
      width,
      height,
      hands: handResult.landmarks.map((landmarks, i) => {
        const category = (handResult.handedness ?? handResult.handednesses)?.[i]?.[0];
        return {
          landmarks: toPoints(landmarks),
          // MediaPipe labels handedness as seen in the image. The camera image
          // is not mirrored here — we mirror only for display — so the label is
          // already the physical hand.
          handedness: (category?.categoryName as Handedness) ?? 'Right',
          handednessScore: category?.score ?? 0,
        };
      }),
      pose: poseResult?.landmarks?.[0] ? toPoints(poseResult.landmarks[0]) : null,
    };

    return { frame, inferenceMs: performance.now() - started };
  }

  close(): void {
    this.hand.close();
    this.pose?.close();
    this.pose = null;
  }
}

/**
 * Whether a worker can host MediaPipe at all.
 *
 * Without OffscreenCanvas there is no canvas to hand it inside a worker, and
 * letting it build its own means touching `document`. In that case the whole
 * pipeline has to run on the main thread instead.
 */
export function workerCanHostVision(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}
