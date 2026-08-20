/**
 * Main-thread landmarking — the fallback when a worker cannot host MediaPipe.
 *
 * Slower by design: landmarking on the main thread competes with rendering, so
 * captions and the commit animation get choppier. It is here because a choppy
 * app that works beats a smooth one that shows a ReferenceError, which is what
 * Safari 16 and earlier got before this existed.
 *
 * Because every millisecond here is a millisecond the UI is frozen, the frame
 * is downscaled before inference rather than handing MediaPipe the full 720p
 * video. The draw costs a fraction of what the saved pixels cost.
 */
import { Landmarker, processingSize } from './landmarkerCore';
import type { VisionInitOptions } from './protocol';
import type { VisionFrame } from './types';

export class InlineLandmarker {
  private landmarker: Landmarker | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  /** Reused scratch canvas the video is downscaled into. */
  private scratch: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private busy = false;
  private maxWidth = 480;

  async init(
    opts: VisionInitOptions,
    maxWidth: number,
  ): Promise<{ delegate: 'GPU' | 'CPU'; poseEnabled: boolean }> {
    this.dispose();
    this.maxWidth = maxWidth;
    // A real canvas, because on the main thread `document` exists — this is
    // precisely the resource the worker path cannot provide on older Safari.
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.width = 1;
    this.glCanvas.height = 1;
    this.landmarker = await Landmarker.create(opts, this.glCanvas, false);
    return { delegate: this.landmarker.delegate, poseEnabled: this.landmarker.poseEnabled };
  }

  setMaxWidth(maxWidth: number): void {
    this.maxWidth = maxWidth;
  }

  /** Returns null when a frame is dropped or nothing is loaded yet. */
  detect(video: HTMLVideoElement, t: number): { frame: VisionFrame; inferenceMs: number } | null {
    if (!this.landmarker || this.busy) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    this.busy = true;
    try {
      const source = this.downscale(video);
      // Landmarks are normalized, so the reported dimensions stay those of the
      // source video: aspect-ratio correction downstream must not see the
      // scratch canvas's size.
      return this.landmarker.detect(source, t, video.videoWidth, video.videoHeight);
    } catch (err) {
      console.warn('Inline landmarker frame failed:', err);
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** Video into a small canvas, or the video itself when it is already small. */
  private downscale(video: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
    const { width, height } = processingSize(video.videoWidth, video.videoHeight, this.maxWidth);
    if (width === video.videoWidth) return video;

    if (!this.scratch) {
      this.scratch = document.createElement('canvas');
      this.scratchCtx = this.scratch.getContext('2d', { alpha: false, willReadFrequently: false });
    }
    if (!this.scratchCtx) return video;

    if (this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch.width = width;
      this.scratch.height = height;
      // Bilinear is plenty for a detector that will resample again anyway.
      this.scratchCtx.imageSmoothingQuality = 'low';
    }
    this.scratchCtx.drawImage(video, 0, 0, width, height);
    return this.scratch;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.glCanvas = null;
    this.scratch = null;
    this.scratchCtx = null;
  }
}
