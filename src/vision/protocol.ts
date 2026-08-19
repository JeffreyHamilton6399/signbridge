/** Message contract between the main thread and the landmarker worker. */
import type { VisionFrame } from './types';

export interface VisionInitOptions {
  /** Where the vendored MediaPipe wasm lives. */
  wasmPath: string;
  handModelPath: string;
  poseModelPath: string;
  numHands: number;
  trackPose: boolean;
  /** 'GPU' falls back to 'CPU' automatically if the delegate fails to build. */
  delegate: 'GPU' | 'CPU';
  minHandDetectionConfidence: number;
  minTrackingConfidence: number;
}

export type VisionRequest =
  | { type: 'init'; options: VisionInitOptions }
  | { type: 'configure'; options: Partial<VisionInitOptions> }
  | { type: 'frame'; bitmap: ImageBitmap; t: number }
  | { type: 'dispose' };

export type VisionResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; poseEnabled: boolean }
  | { type: 'result'; frame: VisionFrame; inferenceMs: number }
  | { type: 'error'; message: string; fatal: boolean };
