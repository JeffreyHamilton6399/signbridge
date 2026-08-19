/**
 * Landmark normalization — pure math, no DOM, no state.
 *
 * Every downstream classifier consumes the output of this module, so a change
 * here invalidates every trained model. The unit tests in tests/normalize.test.ts
 * pin the exact behaviour; treat them as the specification.
 *
 * Pipeline, in order:
 *   1. aspect-correct    image-normalized coords are stretched by the frame's
 *                        aspect ratio; undo that so distances are isotropic
 *   2. mirror            left hands are reflected into right-hand space so one
 *                        model serves both dominant hands
 *   3. translate         wrist (landmark 0) becomes the origin
 *   4. scale             divide by hand span so distance-to-camera drops out
 *   5. rotate            wrist -> middle-MCP points along +y, canonical roll
 */
import type { HandFrame, Point3 } from '@/vision/types';
import { HAND_LANDMARK } from '@/vision/types';

export interface NormalizeOptions {
  /** Frame aspect ratio (width / height). 1 disables aspect correction. */
  aspect?: number;
  /** Reflect left hands into right-hand space. Default true. */
  mirrorLeft?: boolean;
  /** Rotate so the hand's long axis is canonical. Default true. */
  canonicalRotation?: boolean;
}

const EPS = 1e-6;

/** Euclidean distance in 3-space. */
export function dist(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Distance ignoring depth — MediaPipe's z is far noisier than x/y. */
export function dist2d(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Reference length used to scale a hand to unit size.
 *
 * Wrist -> middle-MCP is the most stable segment on the hand: it barely changes
 * with finger articulation, unlike anything involving a fingertip. A closed fist
 * and a flat palm produce nearly the same value, which is exactly what we want.
 */
export function handSpan(landmarks: Point3[]): number {
  const wrist = landmarks[HAND_LANDMARK.WRIST];
  const midMcp = landmarks[HAND_LANDMARK.MIDDLE_MCP];
  const primary = dist(wrist, midMcp);
  if (primary > EPS) return primary;
  // Degenerate hand (all points coincident): fall back to knuckle width.
  const across = dist(landmarks[HAND_LANDMARK.INDEX_MCP], landmarks[HAND_LANDMARK.PINKY_MCP]);
  return across > EPS ? across : 1;
}

/**
 * Normalize one hand to a canonical pose-invariant frame.
 * Returns a fresh array; the input is never mutated.
 */
export function normalizeHand(
  landmarks: Point3[],
  handedness: 'Left' | 'Right',
  opts: NormalizeOptions = {},
): Point3[] {
  const { aspect = 1, mirrorLeft = true, canonicalRotation = true } = opts;

  // 1. aspect correction — x spans `aspect` times the physical width of y.
  const pts: Point3[] = landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z * aspect }));

  // 2. mirror left hands into right-hand space.
  if (mirrorLeft && handedness === 'Left') {
    for (const p of pts) p.x = -p.x;
  }

  // 3. translate wrist to origin.
  const wrist = { ...pts[HAND_LANDMARK.WRIST] };
  for (const p of pts) {
    p.x -= wrist.x;
    p.y -= wrist.y;
    p.z -= wrist.z;
  }

  // 4. scale to unit hand span.
  const span = handSpan(pts);
  const inv = 1 / span;
  for (const p of pts) {
    p.x *= inv;
    p.y *= inv;
    p.z *= inv;
  }

  // 5. rotate about z so wrist -> middle-MCP points along +y.
  if (canonicalRotation) {
    const ref = pts[HAND_LANDMARK.MIDDLE_MCP];
    const len = Math.hypot(ref.x, ref.y);
    if (len > EPS) {
      // Rotation that maps (ref.x, ref.y) onto (0, len).
      const cos = ref.y / len;
      const sin = ref.x / len;
      for (const p of pts) {
        const x = p.x * cos - p.y * sin;
        const y = p.x * sin + p.y * cos;
        p.x = x;
        p.y = y;
      }
    }
  }

  return pts;
}

/** Flatten normalized landmarks to the 63-float vector the classifiers expect. */
export function toFeatureVector(normalized: Point3[]): Float32Array {
  const out = new Float32Array(normalized.length * 3);
  for (let i = 0; i < normalized.length; i++) {
    out[i * 3] = normalized[i].x;
    out[i * 3 + 1] = normalized[i].y;
    out[i * 3 + 2] = normalized[i].z;
  }
  return out;
}

/** Convenience: HandFrame -> 63-float vector in one step. */
export function handFeatureVector(hand: HandFrame, opts: NormalizeOptions = {}): Float32Array {
  return toFeatureVector(normalizeHand(hand.landmarks, hand.handedness, opts));
}

/**
 * Where the hand sits in the frame, in raw image coordinates (0..1).
 * Used by the auto-space heuristic, which cares about absolute position and so
 * must not use the translated/scaled landmarks.
 */
export function handCentroid(landmarks: Point3[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of landmarks) {
    x += p.x;
    y += p.y;
  }
  return { x: x / landmarks.length, y: y / landmarks.length };
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > EPS ? dot / denom : 0;
}

/** Squared L2 distance — cheaper than the real distance for nearest-centroid. */
export function squaredDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

/** Elementwise mean of equal-length vectors. Returns null for an empty set. */
export function meanVector(vectors: Float32Array[]): Float32Array | null {
  if (vectors.length === 0) return null;
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) {
    for (let i = 0; i < out.length; i++) out[i] += v[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= vectors.length;
  return out;
}
