/**
 * Synthetic hand landmarks.
 *
 * Unlike tests/helpers/geometry.ts, which builds HandGeometry directly to test
 * rule logic, these build actual 21-point landmark sets — because the thing
 * under test here is a *learned* model, and a learned model has to be fed
 * something with the shape and correlations of a real hand or the experiment
 * says nothing. Fingers are articulated as chains, so curling one moves three
 * points in a plausible way rather than independently.
 *
 * These are not real hands and nothing measured from them is a claim about
 * accuracy on real ones. What they can honestly answer is comparative: does
 * this model generalise better than that one, given identical inputs.
 */
import type { Point3 } from '@/vision/types';

/** Where each finger's knuckle sits along the knuckle line. */
const MCP_X = [-0.36, -0.12, 0.12, 0.34];
/** Phalanx lengths, proximal to distal. */
const SEGMENTS = [0.38, 0.26, 0.2];

export interface HandSpec {
  /** Curl of index, middle, ring, pinky. 0 = straight, 1 = fully into the palm. */
  curls: [number, number, number, number];
  /** Thumb tip, in the same wrist-origin unit-span frame. */
  thumb: Point3;
  /** Spread of the fingers away from each other, 0..1. */
  spread?: number;
  /**
   * True when the fingers cover the thumb, as in T, N and M.
   *
   * This is the single most important property in the whole file. A tracker
   * does not measure a thumb it cannot see — it infers one, the inference is
   * pulled toward the commonest fist, and it carries far more variance than a
   * measurement does. A synthetic dataset that hands the model a clean,
   * correct thumb tip for T and M is not a model of this problem; it deletes
   * the problem, and every classifier scores near 100% on it.
   *
   * See {@link observedHand}, which is what applies this.
   */
  thumbHidden?: boolean;
}

/** Where a tracker puts a thumb it cannot see: roughly where an A's would be. */
const HALLUCINATED_THUMB: Point3 = { x: -0.44, y: 0.9, z: 0.05 };

/**
 * A hand as 21 landmarks, wrist at the origin, middle knuckle at +y distance 1.
 *
 * Each finger is a chain: the direction rotates by a fixed fraction of the curl
 * at every joint, so a curled finger folds toward the palm through three
 * segments the way a real one does. That articulation is the point — a model
 * trained on independently jittered points would learn correlations no hand has.
 */
export function handOf(spec: HandSpec): Point3[] {
  const { curls, thumb, spread = 0 } = spec;
  const pts: Point3[] = [{ x: 0, y: 0, z: 0 }];

  // Thumb: four points interpolated from a base beside the wrist to the tip.
  const base = { x: -0.3, y: 0.22, z: 0.04 };
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    // Slight bow so the chain is not perfectly straight, as a real thumb is not.
    const bow = Math.sin(t * Math.PI) * 0.06;
    pts.push({
      x: base.x + (thumb.x - base.x) * t + bow,
      y: base.y + (thumb.y - base.y) * t,
      z: base.z + (thumb.z - base.z) * t + bow * 0.5,
    });
  }

  for (let f = 0; f < 4; f++) {
    const curl = curls[f];
    const lean = (MCP_X[f] / 0.36) * spread * 0.28;
    const mcp = { x: MCP_X[f] + lean * 0.3, y: 1, z: 0 };
    pts.push(mcp);

    // Rotation in the y-z plane: straight points along +y, curled folds to -z.
    let angle = 0;
    let x = mcp.x;
    let y = mcp.y;
    let z = mcp.z;
    for (const len of SEGMENTS) {
      angle += curl * 1.45;
      x += lean * 0.22;
      y += Math.cos(angle) * len;
      z -= Math.sin(angle) * len;
      pts.push({ x, y, z });
    }
  }

  return pts;
}

/**
 * The fist cluster and a few open letters, as landmark sets.
 *
 * The four fists differ only in where the thumb tip is, which is the real
 * situation — and in T and M that thumb is underneath the fingers, so its
 * coordinates here stand in for what a tracker would *guess* rather than what
 * it would measure.
 */
export const SYNTHETIC_LETTERS: Record<string, HandSpec> = {
  // The four fists. A and S show their thumb; T and M hide it under the
  // fingers, so what separates them from A is not the thumb at all — it is
  // that the covering fingers are propped up and cannot curl all the way in.
  // One finger in T, three in M. That difference is small, real, and visible,
  // and it is the only thing a model can honestly learn here.
  A: { curls: [1, 1, 1, 1], thumb: { x: -0.46, y: 0.92, z: 0.06 } },
  S: { curls: [1, 1, 1, 1], thumb: { x: 0.02, y: 0.74, z: 0.3 } },
  T: { curls: [0.88, 1, 1, 1], thumb: { x: -0.16, y: 0.86, z: -0.12 }, thumbHidden: true },
  M: { curls: [0.88, 0.88, 0.88, 1], thumb: { x: 0.26, y: 0.82, z: -0.16 }, thumbHidden: true },
  E: { curls: [0.82, 0.82, 0.82, 0.82], thumb: { x: -0.05, y: 0.62, z: 0.18 } },
  B: { curls: [0, 0, 0, 0], thumb: { x: -0.06, y: 0.7, z: 0.24 } },
  V: { curls: [0, 0, 1, 1], thumb: { x: -0.2, y: 0.68, z: 0.2 }, spread: 0.9 },
  U: { curls: [0, 0, 1, 1], thumb: { x: -0.2, y: 0.68, z: 0.2 }, spread: 0 },
  L: { curls: [0, 1, 1, 1], thumb: { x: -0.72, y: 0.5, z: 0.05 } },
  Y: { curls: [1, 1, 1, 0], thumb: { x: -0.78, y: 0.42, z: 0.05 } },
};

/**
 * A hand as a tracker would *report* it, rather than as it is.
 *
 * For a visible thumb that is the truth plus small measurement noise. For a
 * hidden one the reported tip is discarded and replaced by a guess near an A's
 * thumb, with variance an order of magnitude larger — which is the honest model
 * of what MediaPipe does, and the reason T and M read as A.
 *
 * Anything trained or evaluated on these has to earn its accuracy from the
 * fingers, exactly as the real classifier does.
 */
export function observedHand(spec: HandSpec, next: () => number): Point3[] {
  const noise = (s: number) => (next() - 0.5) * s;
  if (!spec.thumbHidden) return handOf(spec);
  return handOf({
    ...spec,
    thumb: {
      x: HALLUCINATED_THUMB.x + noise(0.26),
      y: HALLUCINATED_THUMB.y + noise(0.2),
      z: HALLUCINATED_THUMB.z + noise(0.3),
    },
  });
}
