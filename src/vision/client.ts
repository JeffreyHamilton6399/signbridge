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
import { workerCanHostVision } from './landmarkerCore';
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
    if (this.mode === 'inline' || !this.running) return;
    console.warn(`Vision worker unusable (${reason}); retrying on the main thread.`);

    this.worker?.terminate();
    this.worker = null;
    await this.startInline();
  }

  private async startInline(): Promise<void> {
    this.mode = 'inline';
    this.inline = new InlineLandmarker();
    try {
      const { delegate, poseEnabled } = await this.inline.init(this.options);
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
      void this.inline.init(this.options).catch((err) => {
        this.events.onError?.(describeVisionError(err), true);
      });
    }
  }

  setTargetFps(fps: number): void {
    this.targetFps = Math.max(5, Math.min(60, fps));
  }

  /** Effective capture rate, after the inline ceiling. */
  private get effectiveFps(): number {
    return this.mode === 'inline' ? Math.min(this.targetFps, INLINE_MAX_FPS) : this.targetFps;
  }

  stop(): void {
    this.running = false;
    this.ready = false;
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

  private send(msg: VisionRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private handle(msg: VisionResponse): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.events.onReady?.(msg.delegate, msg.poseEnabled, 'worker');
        break;
      case 'result':
        this.events.onFrame(msg.frame, msg.inferenceMs);
        break;
      case 'error':
        if (msg.fatal) {
          // A fatal worker error before it ever became ready is exactly the
          // Safari-in-a-worker case; try the main thread before giving up.
          if (!this.ready) void this.fallbackToInline(msg.message);
          else this.events.onError?.(describeVisionError(msg.message), true);
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
      // No thread boundary, so the video element goes straight in — no copy.
      const result = this.inline?.detect(video, now);
      if (result) this.events.onFrame(result.frame, result.inferenceMs);
      return;
    }

    try {
      const bitmap = await createImageBitmap(video);
      this.send({ type: 'frame', bitmap, t: now }, [bitmap]);
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
