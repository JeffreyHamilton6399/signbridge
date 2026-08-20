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
 * Resolution inference actually runs at.
 *
 * The camera is opened at 720p because that is what looks good on screen, but
 * feeding 921,600 pixels to a hand detector is waste: MediaPipe's hand model
 * works at 192x192 internally, and every pixel above that is spent on the copy
 * and the texture upload, not on accuracy. Downscaling first is the single
 * largest performance lever in the pipeline, and it costs nothing visible —
 * landmarks come back in normalized 0..1 coordinates, so they map onto the
 * full-resolution video exactly as before.
 *
 * Pose gets more, because it needs the whole torso in frame and its landmarks
 * are spread over a much larger area.
 */
export const PROCESSING_WIDTH_HANDS = 480;
export const PROCESSING_WIDTH_WITH_POSE = 640;

export interface ProcessingSize {
  width: number;
  height: number;
}

/** Target size for inference, preserving aspect ratio. Never upscales. */
export function processingSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
): ProcessingSize {
  if (sourceWidth <= maxWidth || sourceWidth === 0) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = maxWidth / sourceWidth;
  return {
    width: maxWidth,
    // Even dimensions avoid chroma-subsampling artefacts on some decoders.
    height: Math.max(2, Math.round((sourceHeight * scale) / 2) * 2),
  };
}

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

/**
 * The WASM fileset, resolved once per thread.
 *
 * Instantiating a second one is what produced "ModuleFactory not set" on Safari
 * when switching into Signs mode: enabling pose used to tear the landmarker
 * down and rebuild it from scratch, fileset included. Safari does not survive
 * that. It is cached here so it can only ever be built once, and
 * {@link Landmarker.update} changes options in place instead of rebuilding.
 */
let filesetPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null =
  null;

async function fileset(
  wasmPath: string,
  useModule: boolean,
): Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> {
  filesetPromise ??= FilesetResolver.forVisionTasks(wasmPath, useModule);
  return filesetPromise;
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
  /** Kept so pose can be added later without rebuilding anything. */
  private context: {
    wasmPath: string;
    useModule: boolean;
    canvas: CanvasLike;
    poseModelPath: string;
  };

  readonly delegate: 'GPU' | 'CPU';

  private constructor(
    hand: HandLandmarker,
    pose: PoseLandmarker | null,
    delegate: 'GPU' | 'CPU',
    context: Landmarker['context'],
  ) {
    this.hand = hand;
    this.pose = pose;
    this.delegate = delegate;
    this.context = context;
  }

  get poseEnabled(): boolean {
    return this.pose !== null && !this.poseIdle;
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
    const resolved = await fileset(wasmPath, useModule);

    const handModelPath = await resolveAsset(opts.handModelPath, CDN_MODELS.hand);
    const poseModelPath = await resolveAsset(opts.poseModelPath, CDN_MODELS.pose);

    const makeHand = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(resolved, {
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
        pose = await PoseLandmarker.createFromOptions(resolved, {
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

    return new Landmarker(hand, pose, delegate, {
      wasmPath,
      useModule,
      canvas,
      poseModelPath,
    });
  }

  /**
   * Change options in place.
   *
   * Never rebuilds: enabling pose creates only the pose landmarker, reusing the
   * cached fileset, and hand-tracking options go through setOptions. Rebuilding
   * is what broke Safari, and it also dropped a frame of tracking state every
   * time the user switched mode.
   */
  async update(opts: VisionInitOptions): Promise<void> {
    await this.hand.setOptions({
      numHands: opts.numHands,
      minHandDetectionConfidence: opts.minHandDetectionConfidence,
      minHandPresenceConfidence: opts.minHandDetectionConfidence,
      minTrackingConfidence: opts.minTrackingConfidence,
    });

    if (opts.trackPose && !this.pose) {
      try {
        const resolved = await fileset(this.context.wasmPath, this.context.useModule);
        this.pose = await PoseLandmarker.createFromOptions(resolved, {
          baseOptions: { modelAssetPath: this.context.poseModelPath, delegate: this.delegate },
          canvas: this.context.canvas,
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        });
      } catch (err) {
        // Pose is optional. Sign mode degrades to hands-only rather than
        // taking the whole pipeline down with it.
        console.warn('Pose landmarker unavailable:', err);
        this.pose = null;
      }
    } else if (!opts.trackPose && this.pose) {
      // Keep it built but idle: closing and recreating is the expensive,
      // fragile path this method exists to avoid.
      this.poseIdle = true;
    }
    if (opts.trackPose) this.poseIdle = false;
  }

  /** Pose stays constructed but unused when a mode does not need it. */
  private poseIdle = false;

  detect(source: FrameSource, t: number, width: number, height: number): LandmarkerResult {
    const started = performance.now();
    const timestamp = t <= this.lastTimestamp ? this.lastTimestamp + 1 : t;
    this.lastTimestamp = timestamp;

    const handResult = this.hand.detectForVideo(source as never, timestamp);
    const poseResult =
      this.pose && !this.poseIdle ? this.pose.detectForVideo(source as never, timestamp) : null;

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
