/**
 * Main-thread wrapper around landmarking.
 *
 * Owns the capture loop and picks where inference runs:
 *
 *   worker  — the fast path. Landmarking off the main thread, frames shipped
 *             over as transferable ImageBitmaps.
 *   inline  — the fallback. Some browsers cannot host MediaPipe in a worker at
 *             all: without OffscreenCanvas there is no canvas to give it, and
 *             letting it build its own means touching `document`, which does
 *             not exist there. Safari 16 and earlier land here.
 *
 * The switch is automatic and silent to the caller. `mode` reports which one is
 * live so the debug panel can say so, since the frame budget differs a lot.
 *
 * The loop runs on requestVideoFrameCallback where available, so we never
 * landmark the same decoded frame twice, and falls back to rAF elsewhere.
 */
import { InlineLandmarker } from './inlineLandmarker';
import {
  PROCESSING_WIDTH_HANDS,
  PROCESSING_WIDTH_WITH_POSE,
  processingSize,
  workerCanHostVision,
} from './landmarkerCore';
import type { VisionInitOptions, VisionRequest, VisionResponse } from './protocol';
import type { VisionFrame } from './types';

export type VisionMode = 'worker' | 'inline';

export interface VisionClientEvents {
  onFrame(frame: VisionFrame, inferenceMs: number): void;
  onReady?(delegate: 'GPU' | 'CPU', poseEnabled: boolean, mode: VisionMode): void;
  onError?(message: string, fatal: boolean): void;
}

export const DEFAULT_VISION_OPTIONS: VisionInitOptions = {
  wasmPath: '/mediapipe/wasm',
  handModelPath: '/mediapipe/models/hand_landmarker.task',
  poseModelPath: '/mediapipe/models/pose_landmarker_lite.task',
  numHands: 2,
  trackPose: false,
  delegate: 'GPU',
  minHandDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

/**
 * requestVideoFrameCallback is not in every lib.dom yet, and Firefox does not
 * implement it at all, so it is modelled as optional rather than assumed.
 */
type VideoFrameCapable = HTMLVideoElement & {
  requestVideoFrameCallback?(cb: (now: number) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
};

/** Inline landmarking competes with rendering, so it gets a lower ceiling. */
const INLINE_MAX_FPS = 20;

/**
 * Smoothing factor for the measured inference cost. Low enough that one slow
 * frame does not collapse the frame rate, high enough to react within a second.
 */
const COST_SMOOTHING = 0.2;

/**
 * Headroom over measured inference time.
 *
 * Requesting frames faster than they can be processed does not produce more
 * captions — the extra frames are dropped, having already cost a copy — and it
 * grows the gap between what the camera shows and what the overlay draws. Asking
 * only slightly faster than we can answer keeps that gap small.
 */
const PACING_HEADROOM = 1.15;

export class VisionClient {
  private worker: Worker | null = null;
  private inline: InlineLandmarker | null = null;
  private video: VideoFrameCapable | null = null;
  private rafHandle: number | null = null;
  private vfcHandle: number | null = null;
  private running = false;
  private targetFps = 30;
  private lastCapture = 0;
  private events: VisionClientEvents;
  private options: VisionInitOptions = DEFAULT_VISION_OPTIONS;
  private ready = false;
  /** Exponential moving average of inference cost, ms. */
  private costMs = 0;
  /** Whether createImageBitmap accepts the resize options bag here. */
  private canResizeBitmap = true;

  mode: VisionMode = 'worker';

  constructor(events: VisionClientEvents) {
    this.events = events;
  }

  async start(video: HTMLVideoElement, options: Partial<VisionInitOptions> = {}): Promise<void> {
    this.stop();
    this.video = video as VideoFrameCapable;
    this.options = { ...DEFAULT_VISION_OPTIONS, ...options };
    this.running = true;

    if (workerCanHostVision()) {
      this.startWorker();
    } else {
      // No point spawning a worker that cannot possibly succeed.
      console.info('OffscreenCanvas unavailable; landmarking on the main thread.');
      await this.startInline();
    }

    this.schedule();
  }

  private startWorker(): void {
    this.mode = 'worker';
    this.worker = new Worker(new URL('./landmarker.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<VisionResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      // A worker that fails to even load its module lands here.
      void this.fallbackToInline(e.message || 'the vision worker failed to start');
    };
    this.send({ type: 'init', options: this.options });
  }

  /**
   * Move inference to the main thread after the worker turned out to be
   * unusable. Only ever runs once — if inline fails too, the error is real and
   * gets reported.
   */
  private async fallbackToInline(reason: string): Promise<void> {
    if (!this.running) return;
    if (this.mode === 'inline') {
      // Already on the main thread, so this failure is real.
      this.events.onError?.(describeVisionError(reason), true);
      return;
    }
    console.warn(`Vision worker unusable (${reason}); retrying on the main thread.`);

    this.worker?.terminate();
    this.worker = null;
    await this.startInline();
  }

  private async startInline(): Promise<void> {
    this.mode = 'inline';
    this.inline = new InlineLandmarker();
    try {
      const { delegate, poseEnabled } = await this.inline.init(this.options, this.processingWidth);
      this.ready = true;
      this.events.onReady?.(delegate, poseEnabled, 'inline');
    } catch (err) {
      this.events.onError?.(describeVisionError(err), true);
    }
  }

  reconfigure(options: Partial<VisionInitOptions>): void {
    this.options = { ...this.options, ...options };
    if (this.mode === 'worker') {
      this.send({ type: 'configure', options });
    } else if (this.inline) {
      void this.inline.init(this.options, this.processingWidth).catch((err) => {
        this.events.onError?.(describeVisionError(err), true);
      });
    }
  }

  setTargetFps(fps: number): void {
    this.targetFps = Math.max(5, Math.min(60, fps));
  }

  private noteCost(ms: number): void {
    this.costMs = this.costMs === 0 ? ms : this.costMs * (1 - COST_SMOOTHING) + ms * COST_SMOOTHING;
  }

  /** Width inference runs at. Pose needs more of the body in frame than hands do. */
  private get processingWidth(): number {
    return this.options.trackPose ? PROCESSING_WIDTH_WITH_POSE : PROCESSING_WIDTH_HANDS;
  }

  /**
   * Capture rate, after the inline ceiling and after backing off to whatever
   * this device can actually sustain.
   */
  private get effectiveFps(): number {
    const ceiling = this.mode === 'inline' ? Math.min(this.targetFps, INLINE_MAX_FPS) : this.targetFps;
    if (this.costMs <= 0) return ceiling;
    const sustainable = 1000 / (this.costMs * PACING_HEADROOM);
    // Never fall below 8fps: past that the dwell timer stops feeling responsive
    // and it is better to drop frames than to stop tracking.
    return Math.max(8, Math.min(ceiling, sustainable));
  }

  /** What the capture loop is currently pacing itself to, for the debug panel. */
  get pacingFps(): number {
    return this.effectiveFps;
  }

  stop(): void {
    this.running = false;
    this.ready = false;
    this.costMs = 0;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    if (this.vfcHandle !== null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.vfcHandle);
    }
    this.rafHandle = null;
    this.vfcHandle = null;
    if (this.worker) {
      this.send({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.inline?.dispose();
    this.inline = null;
    this.video = null;
  }

  private send(msg: VisionRequest): void {
    // Frames carry an ImageBitmap, which must be transferred rather than
    // structured-cloned — cloning a bitmap copies every pixel.
    this.worker?.postMessage(msg, msg.type === 'frame' ? [msg.bitmap] : []);
  }

  /**
   * Grab a frame at inference resolution.
   *
   * The resize options bag is not universally supported; where it is missing,
   * fall back to a full-size grab rather than failing the frame.
   */
  private async grab(video: HTMLVideoElement): Promise<ImageBitmap> {
    const { width, height } = processingSize(
      video.videoWidth,
      video.videoHeight,
      this.processingWidth,
    );

    if (this.canResizeBitmap && width !== video.videoWidth) {
      try {
        return await createImageBitmap(video, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'low',
        });
      } catch {
        this.canResizeBitmap = false;
      }
    }
    return createImageBitmap(video);
  }

  private handle(msg: VisionResponse): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.events.onReady?.(msg.delegate, msg.poseEnabled, 'worker');
        break;
      case 'result':
        this.noteCost(msg.inferenceMs);
        this.events.onFrame(msg.frame, msg.inferenceMs);
        break;
      case 'error':
        if (msg.fatal) {
          // Any fatal worker error is worth retrying on the main thread, not
          // just one during startup: a worker that dies when the user switches
          // mode leaves them with a dead camera otherwise. fallbackToInline is
          // idempotent, so a repeat failure surfaces instead of looping.
          void this.fallbackToInline(msg.message);
        } else {
          console.warn('Vision worker:', msg.message);
        }
        break;
    }
  }

  private schedule(): void {
    if (!this.running || !this.video) return;
    const video = this.video;

    const tick = (now: number) => {
      if (!this.running) return;
      void this.capture(now);
      this.schedule();
    };

    if (video.requestVideoFrameCallback) {
      this.vfcHandle = video.requestVideoFrameCallback(tick);
    } else {
      this.rafHandle = requestAnimationFrame(tick);
    }
  }

  private async capture(now: number): Promise<void> {
    const video = this.video;
    if (!video || !this.ready || video.readyState < 2 || video.videoWidth === 0) return;

    if (now - this.lastCapture < 1000 / this.effectiveFps) return;
    this.lastCapture = now;

    if (this.mode === 'inline') {
      // No thread boundary; InlineLandmarker does its own downscale.
      this.inline?.setMaxWidth(this.processingWidth);
      const result = this.inline?.detect(video, now);
      if (result) {
        this.noteCost(result.inferenceMs);
        this.events.onFrame(result.frame, result.inferenceMs);
      }
      return;
    }

    try {
      this.send({ type: 'frame', bitmap: await this.grab(video), t: now });
    } catch {
      // A frame can vanish mid-grab when the track ends. Not worth surfacing.
    }
  }
}

/**
 * Turn a raw failure into something a person can act on.
 *
 * "ReferenceError: Can't find variable: document" is a true statement about our
 * code and a useless one to a user standing in front of a camera.
 */
export function describeVisionError(err: unknown): string {
  const message = String((err as Error)?.message ?? err);

  if (/document|OffscreenCanvas/i.test(message)) {
    return 'Hand tracking could not start in this browser. Update to the latest version, or try Chrome or Edge.';
  }
  if (/WebGL|GPU|context/i.test(message)) {
    return 'Hand tracking could not use the graphics card. Switch the inference backend to WASM in Settings > Performance.';
  }
  if (/fetch|network|404|Failed to load/i.test(message)) {
    return 'The hand-tracking model could not be downloaded. Check your connection and reload.';
  }
  if (/memory|allocat/i.test(message)) {
    return 'The browser ran out of memory starting hand tracking. Close other tabs and reload.';
  }
  return `Hand tracking could not start: ${message}`;
}
