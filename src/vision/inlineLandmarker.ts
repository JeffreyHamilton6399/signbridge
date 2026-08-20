/**
 * Main-thread landmarking — the fallback when a worker cannot host MediaPipe.
 *
 * Slower by design: landmarking on the main thread competes with rendering, so
 * captions and the commit animation get choppier. It is here because a choppy
 * app that works beats a smooth one that shows a ReferenceError, which is what
 * Safari 16 and earlier got before this existed.
 *
 * Two things make it cheaper than the worker path:
 *   - the video element is passed to MediaPipe directly, with no ImageBitmap
 *     copy, since there is no thread boundary to cross
 *   - the frame rate is capped harder by the caller (see VisionClient)
 */
import { Landmarker } from './landmarkerCore';
import type { VisionInitOptions } from './protocol';
import type { VisionFrame } from './types';

export class InlineLandmarker {
  private landmarker: Landmarker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private busy = false;

  async init(opts: VisionInitOptions): Promise<{ delegate: 'GPU' | 'CPU'; poseEnabled: boolean }> {
    this.dispose();
    // A real canvas, because on the main thread `document` exists — this is
    // precisely the resource the worker path cannot provide on older Safari.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.landmarker = await Landmarker.create(opts, this.canvas, false);
    return { delegate: this.landmarker.delegate, poseEnabled: this.landmarker.poseEnabled };
  }

  /** Returns null when a frame is dropped or nothing is loaded yet. */
  detect(video: HTMLVideoElement, t: number): { frame: VisionFrame; inferenceMs: number } | null {
    if (!this.landmarker || this.busy) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    this.busy = true;
    try {
      return this.landmarker.detect(video, t, video.videoWidth, video.videoHeight);
    } catch (err) {
      console.warn('Inline landmarker frame failed:', err);
      return null;
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.canvas = null;
  }
}
