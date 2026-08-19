/**
 * Temporal windowing for sign-level recognition.
 *
 * A sign is a trajectory, not a pose, so the classifier consumes a fixed-length
 * window of frames. Two details matter more than they look:
 *
 *   - The window is resampled to a fixed length rather than padded, so the same
 *     sign performed quickly and slowly produces the same feature vector. Speed
 *     is a signer trait, not a lexical one.
 *   - Position is kept relative to the *body*, not the hand, because location
 *     on and around the torso is phonemic in ASL: the same handshape at the chin
 *     and at the chest are different signs.
 */
import type { Point3, VisionFrame } from '@/vision/types';
import { HAND_LANDMARK } from '@/vision/types';
import { normalizeHand } from './normalize';

/** Frames a sign window is resampled to. ~2.1s at 30fps before resampling. */
export const WINDOW_FRAMES = 64;

/**
 * Per-frame feature layout:
 *   dominant hand   21 x 3 = 63   canonical hand space
 *   other hand      21 x 3 = 63   canonical hand space, zeros when absent
 *   hand positions   2 x 3 =  6   wrist location in body space
 *   presence flags        =  2
 * total                     134
 */
export const PER_FRAME_DIM = 63 + 63 + 6 + 2;
export const WINDOW_DIM = WINDOW_FRAMES * PER_FRAME_DIM;

export class RingBuffer<T> {
  private items: T[] = [];
  constructor(private capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }

  get full(): boolean {
    return this.items.length >= this.capacity;
  }

  toArray(): T[] {
    return this.items.slice();
  }

  last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  resize(capacity: number): void {
    this.capacity = capacity;
    while (this.items.length > capacity) this.items.shift();
  }
}

/**
 * Body-relative reference frame taken from the shoulders.
 *
 * Origin sits between the shoulders, scale is shoulder width. This removes how
 * far the signer sits from the camera and how tall they are, while preserving
 * the location contrasts that carry meaning.
 */
export interface BodyFrame {
  originX: number;
  originY: number;
  scale: number;
}

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

export function bodyFrame(pose: Point3[] | null, fallbackAspect = 1): BodyFrame | null {
  if (!pose || pose.length <= RIGHT_SHOULDER) return null;
  const l = pose[LEFT_SHOULDER];
  const r = pose[RIGHT_SHOULDER];
  if (!l || !r) return null;
  const width = Math.hypot((l.x - r.x) * fallbackAspect, l.y - r.y);
  if (width < 1e-4) return null;
  return { originX: (l.x + r.x) / 2, originY: (l.y + r.y) / 2, scale: width };
}

/** Where a wrist sits in body space. Falls back to raw image coords. */
function wristInBody(landmarks: Point3[], frame: BodyFrame | null): Point3 {
  const w = landmarks[HAND_LANDMARK.WRIST];
  if (!frame) return { x: w.x - 0.5, y: w.y - 0.5, z: w.z };
  return {
    x: (w.x - frame.originX) / frame.scale,
    y: (w.y - frame.originY) / frame.scale,
    z: w.z / frame.scale,
  };
}

/** One frame of the sign feature vector. */
export function frameFeatures(
  frame: VisionFrame,
  dominant: 'Left' | 'Right',
): Float32Array {
  const out = new Float32Array(PER_FRAME_DIM);
  const aspect = frame.height > 0 ? frame.width / frame.height : 1;
  const body = bodyFrame(frame.pose, aspect);

  const dominantHand = frame.hands.find((h) => h.handedness === dominant) ?? frame.hands[0];
  const otherHand = frame.hands.find((h) => h !== dominantHand);

  let offset = 0;
  for (const hand of [dominantHand, otherHand]) {
    if (hand) {
      const normalized = normalizeHand(hand.landmarks, hand.handedness, { aspect });
      for (let i = 0; i < 21; i++) {
        out[offset + i * 3] = normalized[i].x;
        out[offset + i * 3 + 1] = normalized[i].y;
        out[offset + i * 3 + 2] = normalized[i].z;
      }
    }
    offset += 63;
  }

  for (const hand of [dominantHand, otherHand]) {
    if (hand) {
      const p = wristInBody(hand.landmarks, body);
      out[offset] = p.x;
      out[offset + 1] = p.y;
      out[offset + 2] = p.z;
    }
    offset += 3;
  }

  out[offset] = dominantHand ? 1 : 0;
  out[offset + 1] = otherHand ? 1 : 0;
  return out;
}

/**
 * Resample a variable-length sequence of per-frame vectors to WINDOW_FRAMES,
 * with linear interpolation between neighbours.
 */
export function resampleWindow(
  frames: readonly Float32Array[],
  targetFrames = WINDOW_FRAMES,
): Float32Array {
  const out = new Float32Array(targetFrames * PER_FRAME_DIM);
  if (frames.length === 0) return out;
  if (frames.length === 1) {
    for (let t = 0; t < targetFrames; t++) out.set(frames[0], t * PER_FRAME_DIM);
    return out;
  }

  for (let t = 0; t < targetFrames; t++) {
    const pos = (t * (frames.length - 1)) / (targetFrames - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const base = t * PER_FRAME_DIM;
    for (let d = 0; d < PER_FRAME_DIM; d++) {
      out[base + d] = a[d] * (1 - f) + b[d] * f;
    }
  }
  return out;
}

/**
 * Motion energy of a window: mean per-frame change in the hand features.
 *
 * Used as the segmentation signal. A sign starts when energy rises above a
 * threshold and ends when it falls back - which is also how the "no sign"
 * class avoids firing while somebody scratches their nose.
 */
export function motionEnergy(frames: readonly Float32Array[]): number {
  if (frames.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < frames.length; i++) {
    let d = 0;
    for (let k = 0; k < 126; k++) {
      const diff = frames[i][k] - frames[i - 1][k];
      d += diff * diff;
    }
    total += Math.sqrt(d);
  }
  return total / (frames.length - 1);
}
