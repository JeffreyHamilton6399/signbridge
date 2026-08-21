/**
 * Named ASL handshapes, as soft predicates over hand geometry.
 *
 * A sign is handshape + location + movement + orientation. This file covers the
 * first of those, so the sign templates can say "flat hand at the chin, moving
 * out" instead of restating finger-extension arithmetic twenty times.
 *
 * Most of these are also manual-alphabet letters, noted in each doc comment.
 * They are written fresh rather than reusing letterTemplates.ts because the
 * letter rules carry absolute-orientation constraints (an I must point up) that
 * are wrong here: the same handshape appears at any angle inside a sign.
 *
 * Every function returns 0..1, and each is a conjunction of soft clauses: the
 * score is the worst-satisfied one. The bands are generous because a signer's
 * handshape drifts mid-sign, but a clause that clearly fails is fatal, because
 * that is what being the wrong handshape means.
 */
import type { HandGeometry } from './handGeometry';
import { clamp01, ramp } from './handGeometry';

const ext = (v: number) => ramp(v, 0.32, 0.68);
const curled = (v: number) => 1 - ramp(v, 0.22, 0.58);
const halfCurled = (v: number) => 1 - Math.min(1, Math.abs(v - 0.5) / 0.38);
const under = (v: number, hi: number, soft = 0.25) => 1 - ramp(v, hi, hi + soft);
const over = (v: number, lo: number, soft = 0.25) => ramp(v, lo - soft, lo);

/**
 * A handshape is a conjunction, not an average.
 *
 * Averaging lets a wrong thumb hide behind four correct fingers — which is how
 * a relaxed, half-open hand scored a perfect 1.0 as a C and made every C-based
 * sign fire whenever someone rested their hand near their face. Taking the
 * worst-satisfied clause instead means "this is a C" requires *every* part of
 * being a C to hold.
 *
 * The clauses are already soft ramps with generous bands, so this is not as
 * brittle as a hard minimum sounds. And when one finger is genuinely
 * mis-detected, refusing to name the handshape is the correct outcome.
 */
function all(parts: number[]): number {
  if (parts.length === 0) return 0;
  return Math.min(...parts);
}

export type HandshapeName =
  | 'flat'
  | 'fist'
  | 'flatO'
  | 'c'
  | 'index'
  | 'ily'
  | 'open'
  | 'claw'
  | 'h'
  | 'v'
  | 'w'
  | 'y'
  | 'thumbUp'
  | 'bent'
  | 'l'
  | 'f'
  | 'babyO'
  | 'x'
  | 'three'
  | 'bentV'
  | 'r'
  | 'four';

/** Flat hand, fingers straight and together. Letter B. */
export function flat(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]), ext(g.four[2]), ext(g.four[3]),
    under(g.gapIndexMiddle, 0.45),
    under(g.gapMiddleRing, 0.45),
  ]);
}

/** Closed fist. Letters A, S, E, M, N, T — this does not try to tell them apart. */
export function fist(g: HandGeometry): number {
  return all([
    curled(g.four[0]), curled(g.four[1]), curled(g.four[2]), curled(g.four[3]),
  ]);
}

/** Flattened O — all fingertips pinched to the thumb. Letter O, and "eat". */
export function flatO(g: HandGeometry): number {
  return all([
    under(g.thumbTo.index, 0.55),
    under(g.thumbTo.middle, 0.8),
    under(g.gapIndexMiddle, 0.55),
    halfCurled(g.four[0]),
    halfCurled(g.four[1]),
  ]);
}

/**
 * Curved C. Letter C, and "drink", "hungry".
 *
 * The thumb clause carries this one. Curved fingers alone describe a hand at
 * rest just as well as a C, so without a genuinely extended, opposing thumb
 * this is not a C — it is somebody's hand hanging by their side.
 */
export function c(g: HandGeometry): number {
  return all([
    halfCurled(g.four[0]), halfCurled(g.four[1]), halfCurled(g.four[2]),
    over(g.thumbTo.index, 0.65),
    under(g.thumbTo.index, 1.5),
    over(g.fingers.thumb.extension, 0.65),
    under(g.gapIndexMiddle, 0.5),
  ]);
}

/** Index finger extended alone. Letters D, G, and every pointing sign. */
export function index(g: HandGeometry): number {
  return all([
    ext(g.four[0]),
    curled(g.four[1]), curled(g.four[2]), curled(g.four[3]),
  ]);
}

/** Thumb, index and pinky out; middle and ring down. The ILY handshape. */
export function ily(g: HandGeometry): number {
  return all([
    ext(g.four[0]),
    curled(g.four[1]), curled(g.four[2]),
    ext(g.four[3]),
    over(g.fingers.thumb.extension, 0.4),
    over(g.thumbAbduction, 0.45),
  ]);
}

/** All five spread and straight. The 5-hand: "what", "finish", "father". */
export function open(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]), ext(g.four[2]), ext(g.four[3]),
    over(g.fingers.thumb.extension, 0.35),
    over(g.gapIndexMiddle, 0.42),
    over(g.gapRingPinky, 0.42),
  ]);
}

/** Spread and half-curled, like gripping a ball. "Want", "more" (open form). */
export function claw(g: HandGeometry): number {
  return all([
    halfCurled(g.four[0]), halfCurled(g.four[1]),
    halfCurled(g.four[2]), halfCurled(g.four[3]),
    over(g.gapIndexMiddle, 0.4),
  ]);
}

/** Index and middle extended together. Letters H and U, and "name". */
export function h(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]),
    curled(g.four[2]), curled(g.four[3]),
    under(g.gapIndexMiddle, 0.45),
  ]);
}

/** Index and middle extended apart. Letter V, and "see", "look". */
export function v(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]),
    curled(g.four[2]), curled(g.four[3]),
    over(g.gapIndexMiddle, 0.6),
  ]);
}

/** Three fingers up and apart. Letter W, and "water". */
export function w(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]), ext(g.four[2]),
    curled(g.four[3]),
    over(g.gapIndexMiddle, 0.38),
    over(g.gapMiddleRing, 0.38),
  ]);
}

/** Thumb and pinky out. Letter Y, and "play", "stay". */
export function y(g: HandGeometry): number {
  return all([
    curled(g.four[0]), curled(g.four[1]), curled(g.four[2]),
    ext(g.four[3]),
    over(g.fingers.thumb.extension, 0.45),
    over(g.thumbTo.pinky, 1.3),
  ]);
}

/** Fist with the thumb sticking up. "Help", "good job", the number 10. */
export function thumbUp(g: HandGeometry): number {
  return all([
    curled(g.four[0]), curled(g.four[1]), curled(g.four[2]), curled(g.four[3]),
    over(g.fingers.thumb.extension, 0.5),
    over(g.thumbAbduction, 0.35),
  ]);
}

/** Fingers straight but bent forward at the knuckles. The bent-B: "bathroom" lid, "chair". */
export function bent(g: HandGeometry): number {
  return all([
    halfCurled(g.four[0]), halfCurled(g.four[1]),
    halfCurled(g.four[2]), halfCurled(g.four[3]),
    under(g.gapIndexMiddle, 0.5),
  ]);
}


/**
 * Thumb and index out at a right angle, other three down. Letter L.
 *
 * The abduction clause is what makes it an L rather than a D with a lazy thumb:
 * the angle between thumb and index is the shape.
 */
export function l(g: HandGeometry): number {
  return all([
    ext(g.four[0]),
    curled(g.four[1]), curled(g.four[2]), curled(g.four[3]),
    over(g.fingers.thumb.extension, 0.55),
    over(g.thumbAbduction, 0.5),
  ]);
}

/** Thumb and index pinched into a circle, other three up. Letter F. */
export function f(g: HandGeometry): number {
  return all([
    under(g.thumbTo.index, 0.45),
    ext(g.four[1]), ext(g.four[2]), ext(g.four[3]),
    under(g.four[0], 0.8),
  ]);
}

/** Thumb and index pinched, other three down. Baby-O: 'who', small quantities. */
export function babyO(g: HandGeometry): number {
  return all([
    under(g.thumbTo.index, 0.45),
    curled(g.four[1]), curled(g.four[2]), curled(g.four[3]),
  ]);
}

/**
 * Index hooked over, everything else closed. Letter X.
 *
 * Distinguished from a fist by the index being half-curled rather than curled,
 * which is a narrow margin on noisy landmarks — X-based signs are the least
 * reliable in this file and are marked confusable with their fist neighbours.
 */
export function x(g: HandGeometry): number {
  return all([
    halfCurled(g.four[0]),
    curled(g.four[1]), curled(g.four[2]), curled(g.four[3]),
    under(g.fingers.thumb.extension, 0.55),
  ]);
}

/** Thumb, index and middle out and spread. Number 3, and 'car' in some forms. */
export function three(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]),
    curled(g.four[2]), curled(g.four[3]),
    over(g.fingers.thumb.extension, 0.55),
    over(g.thumbAbduction, 0.4),
    over(g.gapIndexMiddle, 0.4),
  ]);
}

/** Index and middle bent at the knuckles, apart. Bent-V: 'sit', 'look-at'. */
export function bentV(g: HandGeometry): number {
  return all([
    halfCurled(g.four[0]), halfCurled(g.four[1]),
    curled(g.four[2]), curled(g.four[3]),
    over(g.gapIndexMiddle, 0.45),
  ]);
}

/** Index and middle crossed. Letter R, and 'friend' hooked. */
export function r(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]),
    curled(g.four[2]), curled(g.four[3]),
    g.indexMiddleCrossed ? 1 : 0.05,
  ]);
}

/** Four fingers straight and together, thumb across the palm. Number 4 / B without thumb. */
export function four(g: HandGeometry): number {
  return all([
    ext(g.four[0]), ext(g.four[1]), ext(g.four[2]), ext(g.four[3]),
    over(g.gapIndexMiddle, 0.3),
    under(g.gapIndexMiddle, 0.75),
    under(g.fingers.thumb.extension, 0.5),
  ]);
}

const SHAPES: Record<HandshapeName, (g: HandGeometry) => number> = {
  flat, fist, flatO, c, index, ily, open, claw, h, v, w, y, thumbUp, bent,
  l, f, babyO, x, three, bentV, r, four,
};

/** Score one named handshape. */
export function handshape(name: HandshapeName, g: HandGeometry | null): number {
  if (!g) return 0;
  return clamp01(SHAPES[name](g));
}

/** The best-matching handshape, for the debug overlay. */
export function bestHandshape(g: HandGeometry | null): { name: HandshapeName; score: number } | null {
  if (!g) return null;
  let best: { name: HandshapeName; score: number } | null = null;
  for (const name of Object.keys(SHAPES) as HandshapeName[]) {
    const score = SHAPES[name](g);
    if (!best || score > best.score) best = { name, score };
  }
  return best;
}
