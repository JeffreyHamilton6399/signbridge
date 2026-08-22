/**
 * One canonical hand geometry per static letter.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sign vocabulary got a test that asserts every sign wins its own canonical
 * observation, and it immediately found nine collisions across three batches —
 * templates quietly shadowing each other, which never surfaces as a crash, only
 * as a user signing WAIT and getting WANT.
 *
 * The 24 letter templates are the same kind of code and had no such test. The
 * fist cluster was checked, because that is where the complaints came from, and
 * the other eighteen letters were on trust.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * These are idealised geometries built directly, not landmarks run through
 * MediaPipe. Passing means the rules are mutually consistent — no two templates
 * describe the same hand — and says nothing about accuracy on a real one. Same
 * caveat as tests/helpers/signCases.ts, for the same reason.
 *
 * Where two letters genuinely cannot be separated, the honest move is to name
 * the pair in CONFUSION_CLUSTERS so the correction sheet offers both. Not to
 * bend a template until the test goes green.
 */
import { geometry } from './geometry';
import type { GeometrySpec } from './geometry';
import type { HandGeometry } from '@/features/handGeometry';

/** Fingertips pressed into the palm (A, S) versus resting on a thumb. */
const ON_PALM = 0.15;
const ON_THUMB = 0.34;

/** Knuckle-bend triples: a plain fist, and one/two/three fingers draped. */
const FIST: [number, number, number] = [0.38, 0.38, 0.38];
const ONE_OVER: [number, number, number] = [0.55, 0.4, 0.4];
const TWO_OVER: [number, number, number] = [0.55, 0.55, 0.4];
const THREE_OVER: [number, number, number] = [0.55, 0.55, 0.55];
/** E folds past the knuckles rather than at them. */
const FOLDED: [number, number, number] = [0.24, 0.24, 0.24];

/**
 * The letters, as their maker would form them.
 *
 * `ext` is [thumb, index, middle, ring, pinky] extension. `pointing` is the
 * absolute direction the fingers face in the image: +1 up, -1 down, 0 sideways
 * — it survives rotation normalization on purpose, because G, H, P and Q are
 * defined by it.
 */
export const LETTER_CASES: Record<string, GeometrySpec> = {
  // --- the fist cluster: same hand, thumb in six places --------------------
  A: {
    ext: [0.45, 0.06, 0.06, 0.06, 0.06],
    thumbAcross: -0.15, thumbAlong: 1.25, tipLift: ON_PALM, knuckleBend: FIST,
    thumbToIndex: 0.75, thumbToMiddle: 0.9,
  },
  S: {
    ext: [0.15, 0.06, 0.06, 0.06, 0.06],
    thumbAcross: 0.45, thumbAlong: 0.95, tipLift: ON_PALM, knuckleBend: FIST,
    thumbToIndex: 0.7, thumbToMiddle: 0.75, thumbDepth: 0.35,
  },
  E: {
    ext: [0.1, 0.08, 0.08, 0.08, 0.08],
    thumbAcross: 0.2, thumbAlong: 1.0, tipLift: ON_THUMB, knuckleBend: FOLDED,
    thumbToIndex: 0.45, thumbToMiddle: 0.5, thumbDepth: 0.1,
  },
  T: {
    ext: [0.15, 0.06, 0.06, 0.06, 0.06],
    thumbAcross: 0.3, thumbAlong: 1.0, tipLift: ON_THUMB, knuckleBend: ONE_OVER,
    thumbToIndex: 0.7, thumbToMiddle: 0.85,
  },
  N: {
    ext: [0.15, 0.06, 0.06, 0.06, 0.06],
    thumbAcross: 0.55, thumbAlong: 1.0, tipLift: ON_THUMB, knuckleBend: TWO_OVER,
    thumbToIndex: 0.7, thumbToMiddle: 0.8,
  },
  M: {
    ext: [0.15, 0.06, 0.06, 0.06, 0.06],
    thumbAcross: 0.85, thumbAlong: 1.0, tipLift: ON_THUMB, knuckleBend: THREE_OVER,
    thumbToIndex: 0.8, thumbToMiddle: 0.75,
  },

  // --- open hands ----------------------------------------------------------
  B: {
    ext: [0.12, 0.95, 0.95, 0.95, 0.92],
    gapIndexMiddle: 0.18, gapMiddleRing: 0.18, gapRingPinky: 0.2,
    thumbToIndex: 0.9, pointing: 1,
  },
  C: {
    ext: [0.8, 0.5, 0.5, 0.5, 0.5],
    thumbToIndex: 0.95, thumbToMiddle: 1.1, gapIndexMiddle: 0.3, pointing: 0.4,
  },
  O: {
    ext: [0.45, 0.45, 0.45, 0.45, 0.45],
    thumbToIndex: 0.28, thumbToMiddle: 0.42, gapIndexMiddle: 0.25, pointing: 0.4,
  },

  // --- one finger up -------------------------------------------------------
  D: {
    ext: [0.4, 0.95, 0.1, 0.1, 0.1],
    thumbToIndex: 1.35, thumbToMiddle: 0.35, pointing: 1,
  },
  L: {
    ext: [0.92, 0.95, 0.06, 0.06, 0.06],
    thumbAbduction: 0.85, thumbToIndex: 1.5, thumbToMiddle: 1.2, pointing: 1,
  },
  I: {
    ext: [0.12, 0.06, 0.06, 0.06, 0.95],
    thumbToPinky: 1.9, pointing: 1,
  },
  X: {
    ext: [0.2, 0.5, 0.06, 0.06, 0.06],
    // Hooked hard at the PIP while the finger overall stays half-extended.
    indexPipAngle: 1.35,
    thumbToIndex: 0.75, gapIndexMiddle: 0.25, pointing: 0.9,
  },

  // --- two fingers up ------------------------------------------------------
  U: {
    ext: [0.15, 0.95, 0.95, 0.06, 0.06],
    gapIndexMiddle: 0.2, pointing: 1,
  },
  V: {
    ext: [0.15, 0.95, 0.95, 0.06, 0.06],
    gapIndexMiddle: 0.9, pointing: 1,
  },
  R: {
    ext: [0.15, 0.9, 0.9, 0.06, 0.06],
    gapIndexMiddle: 0.2, indexMiddleCrossed: true, pointing: 1,
  },
  K: {
    ext: [0.7, 0.95, 0.95, 0.06, 0.06],
    gapIndexMiddle: 0.75, thumbToMiddle: 0.9, thumbToIndex: 1.0, pointing: 1,
  },
  W: {
    ext: [0.3, 0.95, 0.95, 0.95, 0.06],
    gapIndexMiddle: 0.55, gapMiddleRing: 0.55, pointing: 1,
  },
  F: {
    ext: [0.5, 0.3, 0.95, 0.95, 0.95],
    thumbToIndex: 0.25, gapMiddleRing: 0.3, gapRingPinky: 0.3, pointing: 1,
  },
  Y: {
    ext: [0.9, 0.06, 0.06, 0.06, 0.95],
    thumbToPinky: 2.1, thumbAbduction: 0.85, pointing: 1,
  },

  // --- sideways and downward, which is the whole of their identity ---------
  G: {
    ext: [0.75, 0.95, 0.06, 0.06, 0.06],
    thumbToIndex: 0.8, thumbAbduction: 0.35, pointing: 0.05,
  },
  H: {
    ext: [0.15, 0.95, 0.95, 0.06, 0.06],
    gapIndexMiddle: 0.2, pointing: 0.05,
  },
  P: {
    ext: [0.7, 0.95, 0.95, 0.06, 0.06],
    gapIndexMiddle: 0.75, thumbToMiddle: 0.9, pointing: -0.8,
  },
  Q: {
    ext: [0.75, 0.95, 0.06, 0.06, 0.06],
    thumbToIndex: 0.8, pointing: -0.8,
  },
};

export function letterCase(letter: string): HandGeometry {
  const spec = LETTER_CASES[letter];
  if (!spec) throw new Error(`No canonical geometry for ${letter}`);
  return geometry(spec);
}
