/**
 * Interpretable hand geometry.
 *
 * These scalars are the vocabulary the rule-based fingerspelling baseline is
 * written in, and they double as extra input features for trained models. They
 * are all derived from *normalized* landmarks (see normalize.ts), so they are
 * invariant to hand size, distance from camera, roll, and handedness.
 *
 * Everything here is a ratio or an angle. Nothing depends on pixels.
 */
import type { Finger, HandFrame, Point3 } from '@/vision/types';
import { FINGERS, FINGER_CHAIN, HAND_LANDMARK } from '@/vision/types';
import { dist, normalizeHand } from './normalize';

export interface FingerState {
  /** 0 = fully curled into the palm, 1 = fully straight. */
  extension: number;
  /** Angle at the PIP joint in radians. ~pi when straight. */
  pipAngle: number;
  /** Unit direction from MCP to tip, in canonical hand space. */
  direction: Point3;
  /** Tip position in canonical hand space. */
  tip: Point3;
}

export interface HandGeometry {
  fingers: Record<Finger, FingerState>;
  /** extension of index/middle/ring/pinky, in that order. */
  four: [number, number, number, number];
  /** Distance between adjacent extended fingertips, in hand spans. */
  gapIndexMiddle: number;
  gapMiddleRing: number;
  gapRingPinky: number;
  /** Thumb tip to each fingertip, in hand spans. */
  thumbTo: Record<Exclude<Finger, 'thumb'>, number>;
  /** Thumb tip to the index MCP knuckle — small when the thumb is tucked in. */
  thumbToIndexMcp: number;
  /** Thumb tip to the palm centre — separates "across the palm" from "beside it". */
  thumbToPalm: number;
  /** How far the thumb sticks out sideways from the hand axis, in hand spans. */
  thumbAbduction: number;
  /** Signed depth of the thumb tip relative to the palm plane. + = toward camera. */
  thumbDepth: number;
  /**
   * Where the thumb tip sits along the knuckle line: 0 at the index knuckle,
   * 1 at the pinky knuckle, negative out past the index on the radial side.
   *
   * This is the feature that separates the fist letters. A, T, N and M are all
   * closed fists distinguished only by where the thumb is, and the obvious way
   * to measure that — depth relative to the palm plane — is the least robust
   * one, because it is dominated by the z channel exactly when the thumb is
   * tucked out of sight. Position *along the knuckles* survives that: the thumb
   * tip of an A sits beside the index knuckle, a T pokes out between index and
   * middle, an N between middle and ring, an M beyond the ring.
   *
   * Fed world landmarks (see {@link geometryOf}) this is a projection onto the
   * real knuckle line rather than its image shadow, so it no longer shrinks
   * when the signer angles their hand toward the camera.
   */
  thumbAcross: number;
  /**
   * Height of the thumb tip along the hand axis, in hand spans. The knuckle row
   * sits at roughly 1. An A's thumb rides up the side of the index finger; a
   * tucked thumb pokes through at or below the knuckles.
   */
  thumbAlong: number;
  /**
   * Where each finger's bend actually is: 0 = all of it beyond the knuckle,
   * 1 = all of it at the knuckle. Index, middle, ring, pinky.
   *
   * This is the fist cluster's only thumb-independent signal, and the reason it
   * exists is that every other approach to A/S/T/N/M asks about a thumb that is
   * underneath the fingers and therefore not being measured at all — MediaPipe
   * infers one, and its inference is pulled toward the commonest fist, an A.
   *
   * The fingers, though, are in plain view, and they are doing different things
   * in each letter:
   *
   *   E     fingertips reach down to meet a folded thumb, so the knuckles stay
   *         relatively open and the bend piles up in the middle and end joints.
   *         Low.
   *   A, S  a real fist: every joint contributes about equally. Middle.
   *   T,N,M the covering fingers lie *over* the thumb, which props them up.
   *         They fold sharply at the knuckle and stay comparatively straight
   *         past it. High — and only for the fingers actually covering the
   *         thumb, which is one in T, two in N, three in M.
   *
   * HONEST CAVEAT: this is reasoned from how the letters are formed, not
   * measured from signers. It is used as a nudge and never as a veto, so if the
   * reasoning is wrong the templates degrade rather than break. Validating it
   * against real recordings is the obvious next step, and until that happens
   * personalization remains the thing that actually fixes this cluster.
   */
  knuckleBend: [number, number, number, number];
  /** Mean of {@link knuckleBend} over index, middle and ring. */
  curlBalance: number;
  /**
   * How far the index/middle/ring fingertips are held off the palm plane, in
   * hand spans. Mean of the three, perpendicular distance, sign discarded.
   *
   * This is the second thumb-independent signal, and unlike {@link knuckleBend}
   * it is a distance rather than a ratio, so the two fail differently. Both the
   * fingertips and the three palm points it is measured against are in plain
   * view in every fist letter, which is the whole point: it says where the
   * thumb is by measuring the fingers resting on top of it.
   *
   *   A, S  a true fist — the fingertips press into the palm. Low.
   *   E     tips fold down onto a thumb lying across the palm. High.
   *   T,N,M tips lie over a thumb tucked underneath them. High.
   *
   * Paired with {@link drapedCount} it separates the cluster in two dimensions:
   * A and S are low-lift and undraped, E is high-lift and undraped, and T, N
   * and M are high-lift with one, two and three fingers draped.
   *
   * HONEST CAVEAT: the bands are reasoned from how the letters are formed, not
   * measured from signers — same caveat as {@link knuckleBend}, and the debug
   * panel now reports both live so it can be checked against a real hand.
   */
  tipLift: number;
  /**
   * Soft count of index/middle/ring lying over the thumb: ~1 in T, ~2 in N,
   * ~3 in M, ~0 in A, S and E. Derived from {@link knuckleBend}, so it says
   * nothing about the thumb itself — which is exactly the point.
   */
  drapedCount: number;
  /** Overall hand direction: unit vector wrist -> middle MCP, canonical space. */
  axis: Point3;
  /**
   * Where the extended fingers point in *image* space, before canonical
   * rotation: +1 straight up, -1 straight down, 0 horizontal. This is the one
   * quantity that must survive rotation normalization, because P/Q/G/H depend
   * on absolute orientation.
   */
  pointing: number;
  /** True when the middle finger crosses over the index (letter R). */
  indexMiddleCrossed: boolean;
  /** Palm normal z-component in canonical space. + = palm toward camera. */
  palmFacing: number;
  /** Mean curl across index..pinky, a quick "is this a fist" signal. */
  fistness: number;
}

function sub(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function norm(v: Point3): Point3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function angleBetween(a: Point3, b: Point3): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  const m = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (m === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, d / m)));
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Map a raw value onto 0..1 across [lo, hi], clamped. */
export function ramp(v: number, lo: number, hi: number): number {
  if (hi === lo) return v >= hi ? 1 : 0;
  return clamp01((v - lo) / (hi - lo));
}

/**
 * Straightness of a finger: how much of the chain's arc length is spanned by
 * the straight line from base to tip. A straight finger scores ~1.0; a finger
 * curled into the palm scores ~0.35. Independent of finger length and of which
 * way the hand is facing.
 */
function chainStraightness(pts: Point3[], chain: readonly [number, number, number, number]): number {
  const [a, b, c, d] = chain;
  const arc = dist(pts[a], pts[b]) + dist(pts[b], pts[c]) + dist(pts[c], pts[d]);
  if (arc === 0) return 0;
  return dist(pts[a], pts[d]) / arc;
}

/**
 * Band over which a finger counts as lying over the thumb rather than curled
 * into a fist. Wide on purpose — see the caveat on {@link HandGeometry.knuckleBend}.
 */
const DRAPE_LO = 0.4;
const DRAPE_HI = 0.58;

/** Below this much total bend the hand is open and the ratio means nothing. */
const MIN_TOTAL_BEND = 0.6;

/**
 * What fraction of a finger's total bend happens at the knuckle.
 *
 * Returns 0.5 — deliberately neutral, not 0 — for a finger that is not bent at
 * all, because the ratio is 0/0 there and any other answer would let an open
 * hand vote on a question only a closed one can answer.
 */
function bendAtKnuckle(
  pts: Point3[],
  chain: readonly [number, number, number, number],
  wrist: Point3,
): number {
  const [mcp, pip, dip, tip] = chain;
  const knuckle = angleBetween(sub(pts[mcp], wrist), sub(pts[pip], pts[mcp]));
  const middle = angleBetween(sub(pts[pip], pts[mcp]), sub(pts[dip], pts[pip]));
  const end = angleBetween(sub(pts[dip], pts[pip]), sub(pts[tip], pts[dip]));
  const total = knuckle + middle + end;
  return total < MIN_TOTAL_BEND ? 0.5 : knuckle / total;
}

/**
 * Compute the full geometry descriptor.
 *
 * @param normalized  landmarks already passed through normalizeHand()
 * @param rawImage    the same hand *before* canonical rotation, used only for
 *                    the absolute `pointing` value. Pass null to skip it.
 */
export function handGeometry(normalized: Point3[], rawImage?: Point3[] | null): HandGeometry {
  const fingers = {} as Record<Finger, FingerState>;

  for (const f of FINGERS) {
    const chain = FINGER_CHAIN[f];
    const [mcp, pip, , tip] = chain;
    const straight = chainStraightness(normalized, chain);
    // The thumb never straightens as much as the other fingers, so it gets its
    // own calibration band.
    const extension =
      f === 'thumb' ? ramp(straight, 0.72, 0.97) : ramp(straight, 0.62, 0.94);
    fingers[f] = {
      extension,
      pipAngle: Math.PI - angleBetween(sub(normalized[pip], normalized[mcp]), sub(normalized[tip], normalized[pip])),
      direction: norm(sub(normalized[tip], normalized[mcp])),
      tip: normalized[tip],
    };
  }

  const L = HAND_LANDMARK;
  const tipOf = (f: Finger) => fingers[f].tip;

  const palmCentre: Point3 = {
    x: (normalized[L.INDEX_MCP].x + normalized[L.PINKY_MCP].x + normalized[L.WRIST].x) / 3,
    y: (normalized[L.INDEX_MCP].y + normalized[L.PINKY_MCP].y + normalized[L.WRIST].y) / 3,
    z: (normalized[L.INDEX_MCP].z + normalized[L.PINKY_MCP].z + normalized[L.WRIST].z) / 3,
  };

  // Knuckle line, index -> pinky. In canonical right-hand space x increases
  // across the knuckles in that direction (see normalize.ts).
  const knuckle = sub(normalized[L.PINKY_MCP], normalized[L.INDEX_MCP]);
  const knuckleWidth = Math.hypot(knuckle.x, knuckle.y, knuckle.z) || 1;
  const knuckleAxis = norm(knuckle);
  const thumbFromIndex = sub(tipOf('thumb'), normalized[L.INDEX_MCP]);
  const thumbAcross =
    (thumbFromIndex.x * knuckleAxis.x +
      thumbFromIndex.y * knuckleAxis.y +
      thumbFromIndex.z * knuckleAxis.z) /
    knuckleWidth;

  const palmNormal = norm(
    cross(sub(normalized[L.INDEX_MCP], normalized[L.WRIST]), sub(normalized[L.PINKY_MCP], normalized[L.WRIST])),
  );

  // How far the covering fingers are held off the palm. Perpendicular offset
  // from the palm plane, so it measures clearance rather than how far across
  // the palm the tip has travelled.
  const liftOf = (f: Finger) => {
    const d = sub(fingers[f].tip, palmCentre);
    return Math.abs(d.x * palmNormal.x + d.y * palmNormal.y + d.z * palmNormal.z);
  };
  const tipLift = (liftOf('index') + liftOf('middle') + liftOf('ring')) / 3;

  // Absolute pointing direction, from the pre-rotation landmarks. Image y grows
  // downward, so an upward-pointing hand has a negative dy.
  let pointing = 1;
  if (rawImage && rawImage.length === normalized.length) {
    const v = sub(rawImage[L.MIDDLE_MCP], rawImage[L.WRIST]);
    const m = Math.hypot(v.x, v.y) || 1;
    pointing = -v.y / m;
  }

  const four: [number, number, number, number] = [
    fingers.index.extension,
    fingers.middle.extension,
    fingers.ring.extension,
    fingers.pinky.extension,
  ];

  const knuckleBend = (['index', 'middle', 'ring', 'pinky'] as const).map((f) =>
    bendAtKnuckle(normalized, FINGER_CHAIN[f], normalized[L.WRIST]),
  ) as [number, number, number, number];
  // Pinky is excluded: it is the one finger never over the thumb in M, and it
  // curls along with the others in A and S, so it only adds noise to the axis
  // these three are separated on.
  const curlBalance = (knuckleBend[0] + knuckleBend[1] + knuckleBend[2]) / 3;
  const drapedCount =
    ramp(knuckleBend[0], DRAPE_LO, DRAPE_HI) +
    ramp(knuckleBend[1], DRAPE_LO, DRAPE_HI) +
    ramp(knuckleBend[2], DRAPE_LO, DRAPE_HI);

  // R is index and middle crossed. In canonical right-hand space the index sits
  // at negative x relative to the middle; when crossed that order flips while
  // both fingers stay extended and their tips stay close together.
  const indexMiddleCrossed =
    four[0] > 0.6 &&
    four[1] > 0.6 &&
    tipOf('index').x > tipOf('middle').x &&
    dist(tipOf('index'), tipOf('middle')) < 0.55;

  return {
    fingers,
    four,
    gapIndexMiddle: dist(tipOf('index'), tipOf('middle')),
    gapMiddleRing: dist(tipOf('middle'), tipOf('ring')),
    gapRingPinky: dist(tipOf('ring'), tipOf('pinky')),
    thumbTo: {
      index: dist(tipOf('thumb'), tipOf('index')),
      middle: dist(tipOf('thumb'), tipOf('middle')),
      ring: dist(tipOf('thumb'), tipOf('ring')),
      pinky: dist(tipOf('thumb'), tipOf('pinky')),
    },
    thumbToIndexMcp: dist(tipOf('thumb'), normalized[L.INDEX_MCP]),
    thumbToPalm: dist(tipOf('thumb'), palmCentre),
    thumbAbduction: Math.abs(tipOf('thumb').x - normalized[L.INDEX_MCP].x),
    thumbDepth:
      (tipOf('thumb').x - palmCentre.x) * palmNormal.x +
      (tipOf('thumb').y - palmCentre.y) * palmNormal.y +
      (tipOf('thumb').z - palmCentre.z) * palmNormal.z,
    thumbAcross,
    thumbAlong: tipOf('thumb').y,
    knuckleBend,
    curlBalance,
    tipLift,
    drapedCount,
    axis: norm(sub(normalized[L.MIDDLE_MCP], normalized[L.WRIST])),
    pointing,
    indexMiddleCrossed,
    palmFacing: -palmNormal.z,
    fistness: 1 - (four[0] + four[1] + four[2] + four[3]) / 4,
  };
}

/**
 * Geometry for one tracked hand — the entry point every caller should use.
 *
 * There is one decision here and it is worth stating plainly: **shape comes
 * from world landmarks when MediaPipe provides them, orientation always comes
 * from the image.**
 *
 * Image-space landmarks are a projection. A finger pointing at the camera is
 * foreshortened in x and y, and the z channel that would recover its true
 * length is a weakly-supervised offset in image units, not a measurement. The
 * practical result is that an extended finger aimed at the lens reads as a
 * curled one — which is why D, L, G and the pointing letters degrade the moment
 * the signer turns their hand. World landmarks are metric and hand-centred, so
 * chain straightness, fingertip gaps and thumb position all survive rotation.
 *
 * What world space cannot tell us is which way the hand points *in the frame*,
 * because it discards the camera entirely — and P/Q/G/H are distinguished by
 * exactly that. So `pointing` keeps coming from the raw image landmarks.
 *
 * Falls back to image space when `world` is absent, which keeps hand-built test
 * frames and recorded fixtures working unchanged.
 */
export function geometryOf(hand: HandFrame, aspect = 1): HandGeometry {
  const unrotatedImage = normalizeHand(hand.landmarks, hand.handedness, {
    aspect,
    canonicalRotation: false,
  });
  // World coordinates are already isotropic, so they need no aspect correction.
  const shape = hand.world
    ? normalizeHand(hand.world, hand.handedness, { aspect: 1 })
    : normalizeHand(hand.landmarks, hand.handedness, { aspect });
  return handGeometry(shape, unrotatedImage);
}
