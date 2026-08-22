/**
 * Synthetic variation for on-device personalization.
 *
 * WHY THIS EXISTS
 * ---------------
 * Calibration asks for eight samples of a letter. Eight points in 63 dimensions
 * determine almost nothing: any classifier with enough capacity to be useful
 * will memorise them exactly and generalise to nothing, and any classifier
 * small enough not to — a linear head — cannot represent the interactions that
 * separate the hard letters in the first place.
 *
 * Augmentation is the way out. The eight samples are eight *poses*; what varies
 * between one signing session and the next is not the pose but how the hand is
 * angled at the camera and how much the tracker is guessing. Simulating that
 * variation turns eight poses into as many training vectors as we care to draw,
 * and it is cheap: a rotation and some noise over 21 points.
 *
 * WHAT IS SIMULATED, AND WHY EACH ONE
 * -----------------------------------
 * **Out-of-plane tilt.** normalize.ts removes roll — rotation in the image
 * plane — and nothing else. Tilting the hand toward or away from the lens is
 * the largest remaining source of variation between recordings, and it is the
 * one that breaks the geometric rules: a finger pointing at the camera is
 * foreshortened and reads as curled. A model that has seen its own letters at
 * a range of tilts stops caring.
 *
 * **Per-landmark jitter.** MediaPipe's output shakes frame to frame even on a
 * motionless hand. Training on the shake teaches the model which coordinates
 * are load-bearing and which are noise.
 *
 * **More jitter on z than on x and y.** MediaPipe's z is a weakly supervised
 * offset rather than a measurement, and it is worst exactly where it matters
 * most: an occluded thumb. Noising it harder is a direct instruction not to
 * lean on it — which is the same lesson the fist-cluster templates encode by
 * hand in letterTemplates.ts, learned rather than written down.
 *
 * WHAT IS NOT SIMULATED
 * ---------------------
 * Not roll: normalize.ts already removes it, so rotating in-plane produces the
 * identical feature vector and would be wasted work.
 *
 * Not scale or translation: same reason. The wrist is at the origin and the
 * hand span is 1 by construction.
 *
 * Not finger articulation — bending a joint slightly to make a "different" A.
 * Doing that correctly needs a kinematic model of the hand, and doing it
 * incorrectly generates poses no hand can make, which teaches the model that
 * impossible things are examples of the letter. Jitter approximates the small
 * end of it honestly; the large end needs real recordings, not synthesis.
 *
 * HONEST LIMIT: augmentation cannot invent information. If two letters are
 * genuinely indistinguishable in the samples given — which is the case for a
 * thumb the camera never saw — no amount of it will separate them. What it does
 * is let a model with real capacity be fitted without overfitting, so that
 * whatever difference *is* in the samples can actually be learned.
 */
import type { Point3 } from '@/vision/types';
import { normalizeHand, toFeatureVector } from './normalize';

export interface AugmentOptions {
  /** Peak out-of-plane tilt about the x and y axes, in radians. */
  tilt?: number;
  /** Standard deviation of per-landmark noise on x and y, in hand spans. */
  jitter?: number;
  /** Standard deviation on z. Larger by default — see the note above. */
  jitterZ?: number;
}

export const DEFAULT_AUGMENT: Required<AugmentOptions> = {
  // ~11 degrees. Large enough to matter, small enough that the hand is still
  // recognisably facing the camera — past roughly 25 degrees a real tracker
  // starts losing landmarks outright, and a sample it would never produce is
  // not a useful thing to train on.
  tilt: 0.2,
  jitter: 0.012,
  jitterZ: 0.03,
};

/**
 * A small, fast, seedable PRNG (mulberry32).
 *
 * Seedable because augmentation feeds training, and training that cannot be
 * reproduced cannot be debugged: "the model came out worse this time" needs to
 * be answerable with something other than a shrug.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform source, via Box-Muller. */
function gaussian(next: () => number): number {
  const u = Math.max(next(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

/** The 63-float vector back into 21 points. */
export function toPoints(features: Float32Array): Point3[] {
  const pts: Point3[] = new Array(features.length / 3);
  for (let i = 0; i < pts.length; i++) {
    pts[i] = { x: features[i * 3], y: features[i * 3 + 1], z: features[i * 3 + 2] };
  }
  return pts;
}

/**
 * One augmented variant of a normalized sample.
 *
 * The result is re-normalized before being returned, which is the part that
 * matters: it guarantees every synthetic sample satisfies the same invariants
 * as a real one — wrist at the origin, unit hand span, canonical roll. Skipping
 * that would train the model on a region of the space that inference can never
 * visit, and the fit would look fine while being useless.
 *
 * Because re-normalization is the same function the frame path calls, this
 * cannot drift from it. If normalize.ts changes, augmentation changes with it.
 */
export function augment(
  features: Float32Array,
  next: () => number,
  opts: AugmentOptions = {},
): Float32Array {
  const { tilt, jitter, jitterZ } = { ...DEFAULT_AUGMENT, ...opts };
  const pts = toPoints(features);

  // Tilt toward and away from the lens. Uniform over the band rather than
  // Gaussian: the point is to cover the range of angles evenly, not to
  // concentrate samples at the angle we already have eight of.
  const ax = (next() * 2 - 1) * tilt;
  const ay = (next() * 2 - 1) * tilt;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);

  for (const p of pts) {
    // About x, then about y.
    const y1 = p.y * cx - p.z * sx;
    const z1 = p.y * sx + p.z * cx;
    const x2 = p.x * cy + z1 * sy;
    const z2 = -p.x * sy + z1 * cy;

    p.x = x2 + gaussian(next) * jitter;
    p.y = y1 + gaussian(next) * jitter;
    p.z = z2 + gaussian(next) * jitterZ;
  }

  // Back onto the manifold the frame path produces. Handedness is 'Right'
  // because stored samples are already in right-hand space — normalizeHand
  // mirrored them on the way in, and mirroring twice would undo it.
  return toFeatureVector(normalizeHand(pts, 'Right', { aspect: 1 }));
}
