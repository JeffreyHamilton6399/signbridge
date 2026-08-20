/**
 * Geometric templates for the 24 static letters of the ASL manual alphabet.
 *
 * WHY THIS EXISTS
 * ---------------
 * A trained MLP on landmark vectors beats these rules comfortably - but it needs
 * data. This baseline gives the app a working, inspectable classifier on day one
 * with no dataset, and it stays useful afterwards as a prior that regularises a
 * thinly-trained personal model (see calibration.ts).
 *
 * HONEST LIMITS. Two clusters are genuinely hard from landmarks alone because
 * the discriminating feature is an occluded thumb:
 *   - A / M / N / S / T / E  differ only in where the thumb is tucked
 *   - R / U / V              differ by crossing vs. spacing of two fingers
 *
 * MediaPipe does not *measure* a hidden thumb, it infers one, and its inference
 * is drawn toward the commonest fist — which is an A. That is why a T or an M
 * reads as an A: the landmarks handed to these rules already say A. The fist
 * letters are therefore keyed on thumbAcross, a purely 2D measure of where the
 * thumb tip sits along the knuckle line, which degrades more gracefully than
 * anything using z. It is still inference, not measurement.
 *
 * The reliable fix is personalization. A model fitted to what MediaPipe
 * actually reports for *this* signer's T can separate it from their A even when
 * both look like an A to a rule, provided the two differ consistently — and
 * they usually do. Correcting a letter in the UI files it as a training sample
 * for exactly this reason. The debug panel reports per-letter accuracy. Do not
 * paper over it.
 *
 * Every rule is written against handGeometry() output, which is scale-, roll-
 * and handedness-invariant.
 */
import type { HandGeometry } from '@/features/handGeometry';
import { clamp01, ramp } from '@/features/handGeometry';

/** Letters recognised from a single frame. J and Z are handled by motion.ts. */
export const STATIC_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y',
] as const;

export const MOTION_LETTERS = ['J', 'Z'] as const;

export const ALL_LETTERS: readonly string[] = [...STATIC_LETTERS, ...MOTION_LETTERS].sort();

/** The known-hard clusters, surfaced in the UI so users know where to look. */
export const CONFUSION_CLUSTERS: Record<string, readonly string[]> = {
  A: ['S', 'T', 'M', 'N', 'E'],
  E: ['S', 'M', 'N', 'O'],
  M: ['N', 'S', 'T', 'E'],
  N: ['M', 'T', 'S'],
  S: ['A', 'T', 'M', 'E'],
  T: ['S', 'N', 'A'],
  R: ['U', 'V'],
  U: ['R', 'V', 'H'],
  V: ['U', 'R', 'K'],
  K: ['V', 'P'],
  P: ['K', 'Q'],
  Q: ['G', 'P'],
  G: ['Q', 'H'],
  H: ['U', 'G'],
  D: ['F', 'X'],
  O: ['C', 'E'],
  C: ['O'],
};

// ---------------------------------------------------------------------------
// Soft predicates. Each returns 0..1; the letter score is their geometric mean,
// so one confidently-failed predicate is enough to rule a letter out.
// ---------------------------------------------------------------------------

/** Finger is extended. */
const up = (v: number) => ramp(v, 0.32, 0.68);
/** Finger is curled into the palm. */
const down = (v: number) => 1 - ramp(v, 0.22, 0.58);
/** Finger is half-curled (C, O, X). */
const half = (v: number) => 1 - Math.min(1, Math.abs(v - 0.5) / 0.38);
/** Value is below `hi`, with a soft shoulder. */
const below = (v: number, hi: number, soft = 0.25) => 1 - ramp(v, hi, hi + soft);
/** Value is above `lo`, with a soft shoulder. */
const above = (v: number, lo: number, soft = 0.25) => ramp(v, lo - soft, lo);
/** Value sits near `target`. */
const near = (v: number, target: number, tol: number) =>
  clamp01(1 - Math.abs(v - target) / tol);

function geomean(parts: number[]): number {
  if (parts.length === 0) return 0;
  let logSum = 0;
  for (const p of parts) logSum += Math.log(Math.max(p, 1e-4));
  return Math.exp(logSum / parts.length);
}

export interface LetterTemplate {
  letter: string;
  /** Plain-language description shown in the correction sheet and tutorial. */
  hint: string;
  score(g: HandGeometry): number;
}

const T = (letter: string, hint: string, score: (g: HandGeometry) => number): LetterTemplate => ({
  letter,
  hint,
  score,
});

export const LETTER_TEMPLATES: readonly LetterTemplate[] = [
  T('A', 'Fist, thumb resting alongside the index finger.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]), down(g.four[3]),
      // The thumb sits beside the index knuckle, not tucked in among the
      // fingers. This is what separates A from T, N and M, and it is measured
      // across the knuckles rather than in depth because MediaPipe invents a
      // plausible thumb whenever the real one is hidden — and its guess looks
      // like an A.
      below(g.thumbAcross, 0.18, 0.2),
      above(g.fingers.thumb.extension, 0.3),
    ]),
  ),

  T('B', 'Flat hand, fingers together and straight, thumb folded across the palm.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]), up(g.four[2]), up(g.four[3]),
      below(g.gapIndexMiddle, 0.42), below(g.gapMiddleRing, 0.42), below(g.gapRingPinky, 0.45),
      down(g.fingers.thumb.extension),
      below(g.thumbToPalm, 0.95),
    ]),
  ),

  T('C', 'Hand curved into a C, thumb and fingers apart.', (g) =>
    geomean([
      half(g.four[0]), half(g.four[1]), half(g.four[2]), half(g.four[3]),
      // The C opening: thumb and index tips are apart but the fingers are curved.
      near(g.thumbTo.index, 0.95, 0.75),
      above(g.thumbTo.index, 0.6),
      above(g.fingers.thumb.extension, 0.25),
    ]),
  ),

  T('D', 'Index finger up, other fingertips meeting the thumb.', (g) =>
    geomean([
      up(g.four[0]),
      down(g.four[1]), down(g.four[2]), down(g.four[3]),
      below(g.thumbTo.middle, 0.6),
      above(g.thumbTo.index, 0.9),
    ]),
  ),

  T('E', 'Fingers curled down, fingertips resting on the folded thumb.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]), down(g.four[3]),
      down(g.fingers.thumb.extension),
      // Tips come down to meet the thumb, unlike S where they clamp over it.
      below(g.thumbTo.index, 0.62), below(g.thumbTo.middle, 0.72),
      below(Math.abs(g.thumbDepth), 0.3),
    ]),
  ),

  T('F', 'Thumb and index make a circle, other three fingers up.', (g) =>
    geomean([
      below(g.thumbTo.index, 0.42),
      up(g.four[1]), up(g.four[2]), up(g.four[3]),
      below(g.four[0], 0.75, 0.3),
    ]),
  ),

  T('G', 'Index finger and thumb extended, pointing sideways.', (g) =>
    geomean([
      up(g.four[0]),
      down(g.four[1]), down(g.four[2]), down(g.four[3]),
      above(g.fingers.thumb.extension, 0.4),
      // Sideways, not up: this is what separates G from D and L.
      below(Math.abs(g.pointing), 0.55),
      above(g.thumbTo.index, 0.55),
    ]),
  ),

  T('H', 'Index and middle fingers together, pointing sideways.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]),
      down(g.four[2]), down(g.four[3]),
      below(g.gapIndexMiddle, 0.5),
      below(Math.abs(g.pointing), 0.55),
    ]),
  ),

  T('I', 'Pinky up, everything else closed.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]),
      up(g.four[3]),
      down(g.fingers.thumb.extension),
      above(g.pointing, 0.3),
    ]),
  ),

  T('K', 'Index and middle up in a V, thumb between them.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]),
      down(g.four[2]), down(g.four[3]),
      above(g.gapIndexMiddle, 0.5),
      above(g.fingers.thumb.extension, 0.35),
      // Thumb tucks in against the middle finger's base, unlike V.
      below(g.thumbTo.middle, 1.25),
      above(g.pointing, 0.25),
    ]),
  ),

  T('L', 'Index up, thumb out - an L shape.', (g) =>
    geomean([
      up(g.four[0]),
      down(g.four[1]), down(g.four[2]), down(g.four[3]),
      above(g.fingers.thumb.extension, 0.5),
      above(g.thumbAbduction, 0.55),
      above(g.thumbTo.index, 1.0),
      above(g.pointing, 0.2),
    ]),
  ),

  T('M', 'Thumb tucked under three fingers.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]), down(g.four[3]),
      // Thumb tip emerges past the ring knuckle, near the pinky.
      above(g.thumbAcross, 0.62, 0.25),
      below(g.thumbAcross, 1.15, 0.25),
      down(g.fingers.thumb.extension),
    ]),
  ),

  T('N', 'Thumb tucked under two fingers.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]), down(g.four[3]),
      // Between the middle and ring knuckles: further in than T, short of M.
      near(g.thumbAcross, 0.55, 0.3),
      down(g.fingers.thumb.extension),
    ]),
  ),

  T('O', 'All fingertips meet the thumb in a round O.', (g) =>
    geomean([
      half(g.four[0]), half(g.four[1]), half(g.four[2]), half(g.four[3]),
      below(g.thumbTo.index, 0.5),
      below(g.thumbTo.middle, 0.72),
      below(g.gapIndexMiddle, 0.5),
    ]),
  ),

  T('P', 'K shape rotated to point downward.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]),
      down(g.four[2]), down(g.four[3]),
      above(g.gapIndexMiddle, 0.45),
      above(g.fingers.thumb.extension, 0.3),
      below(g.pointing, -0.15, 0.45),
    ]),
  ),

  T('Q', 'G shape rotated to point downward.', (g) =>
    geomean([
      up(g.four[0]),
      down(g.four[1]), down(g.four[2]), down(g.four[3]),
      above(g.fingers.thumb.extension, 0.35),
      below(g.pointing, -0.15, 0.45),
      above(g.thumbTo.index, 0.5),
    ]),
  ),

  T('R', 'Index and middle fingers crossed.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]),
      down(g.four[2]), down(g.four[3]),
      g.indexMiddleCrossed ? 1 : 0.12,
      below(g.gapIndexMiddle, 0.45),
      above(g.pointing, 0.2),
    ]),
  ),

  T('S', 'Fist with the thumb crossing in front of the fingers.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]), down(g.four[3]),
      down(g.fingers.thumb.extension),
      // Lying across the front of the fist, so the tip reaches the middle of
      // the knuckle line but stays low against it rather than poking through.
      near(g.thumbAcross, 0.45, 0.45),
      below(g.thumbAlong, 1.05, 0.3),
    ]),
  ),

  T('T', 'Fist with the thumb poking between index and middle fingers.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]), down(g.four[3]),
      // Just inside the index knuckle — the shallowest of the tucked thumbs.
      near(g.thumbAcross, 0.3, 0.28),
      down(g.fingers.thumb.extension),
    ]),
  ),

  T('U', 'Index and middle up and together.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]),
      down(g.four[2]), down(g.four[3]),
      below(g.gapIndexMiddle, 0.4),
      g.indexMiddleCrossed ? 0.15 : 1,
      above(g.pointing, 0.35),
    ]),
  ),

  T('V', 'Index and middle up and apart.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]),
      down(g.four[2]), down(g.four[3]),
      above(g.gapIndexMiddle, 0.62),
      down(g.fingers.thumb.extension),
      above(g.pointing, 0.35),
    ]),
  ),

  T('W', 'Index, middle and ring up and apart.', (g) =>
    geomean([
      up(g.four[0]), up(g.four[1]), up(g.four[2]),
      down(g.four[3]),
      above(g.gapIndexMiddle, 0.4),
      above(g.gapMiddleRing, 0.4),
      above(g.pointing, 0.3),
    ]),
  ),

  T('X', 'Index finger hooked, everything else closed.', (g) =>
    geomean([
      half(g.four[0]),
      down(g.four[1]), down(g.four[2]), down(g.four[3]),
      down(g.fingers.thumb.extension),
      // The hook: bent at the PIP but the fingertip still clears the palm.
      near(g.fingers.index.pipAngle, 1.35, 1.0),
      above(g.pointing, 0.2),
    ]),
  ),

  T('Y', 'Thumb and pinky out, middle three closed.', (g) =>
    geomean([
      down(g.four[0]), down(g.four[1]), down(g.four[2]),
      up(g.four[3]),
      above(g.fingers.thumb.extension, 0.45),
      above(g.thumbAbduction, 0.5),
      above(g.thumbTo.pinky, 1.3),
    ]),
  ),
];

export const TEMPLATE_BY_LETTER: ReadonlyMap<string, LetterTemplate> = new Map(
  LETTER_TEMPLATES.map((t) => [t.letter, t]),
);

export function letterHint(letter: string): string {
  return TEMPLATE_BY_LETTER.get(letter)?.hint ?? '';
}
