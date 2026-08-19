/**
 * Main-thread wrapper around the landmarker worker.
 *
 * Owns the capture loop: grab a bitmap from the video element, ship it over,
 * receive landmarks. The loop is driven by requestVideoFrameCallback where the
 * browser supports it (only fires on genuinely new frames, so we never
 * landmark the same image twice) and falls back to rAF elsewhere.
 */
import type { VisionInitOptions, VisionRequest, VisionResponse } from './protocol';
import type { VisionFrame } from './types';

export interface VisionClientEvents {
  onFrame(frame: VisionFrame, inferenceMs: number): void;
  onReady?(delegate: 'GPU' | 'CPU', poseEnabled: boolean): void;
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

export class VisionClient {
  private worker: Worker | null = null;
  private video: VideoFrameCapable | null = null;
  private rafHandle: number | null = null;
  private vfcHandle: number | null = null;
  private running = false;
  private targetFps = 30;
  private lastCapture = 0;
  private events: VisionClientEvents;

  constructor(events: VisionClientEvents) {
    this.events = events;
  }

  async start(video: HTMLVideoElement, options: Partial<VisionInitOptions> = {}): Promise<void> {
    this.stop();
    this.video = video as VideoFrameCapable;
    this.worker = new Worker(new URL('./landmarker.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<VisionResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.events.onError?.(e.message || 'Worker crashed', true);

    this.send({ type: 'init', options: { ...DEFAULT_VISION_OPTIONS, ...options } });
    this.running = true;
    this.schedule();
  }

  reconfigure(options: Partial<VisionInitOptions>): void {
    this.send({ type: 'configure', options });
  }

  setTargetFps(fps: number): void {
    this.targetFps = Math.max(5, Math.min(60, fps));
  }

  stop(): void {
    this.running = false;
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
    this.video = null;
  }

  private send(msg: VisionRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private handle(msg: VisionResponse): void {
    switch (msg.type) {
      case 'ready':
        this.events.onReady?.(msg.delegate, msg.poseEnabled);
        break;
      case 'result':
        this.events.onFrame(msg.frame, msg.inferenceMs);
        break;
      case 'error':
        this.events.onError?.(msg.message, msg.fatal);
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
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    const minInterval = 1000 / this.targetFps;
    if (now - this.lastCapture < minInterval) return;
    this.lastCapture = now;

    try {
      const bitmap = await createImageBitmap(video);
      this.send({ type: 'frame', bitmap, t: now }, [bitmap]);
    } catch {
      // A frame can vanish mid-grab when the track ends. Not worth surfacing.
    }
  }
}
