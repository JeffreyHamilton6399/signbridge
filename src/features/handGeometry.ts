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
import type { Finger, Point3 } from '@/vision/types';
import { FINGERS, FINGER_CHAIN, HAND_LANDMARK } from '@/vision/types';
import { dist } from './normalize';

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
   * This is the feature that separates the fist letters, and it is purely 2D on
   * purpose. A, T, N and M are all closed fists distinguished only by where the
   * thumb is, and the obvious way to measure that — depth relative to the palm
   * plane — leans on MediaPipe's z, which is its least reliable channel and is
   * worst exactly when the thumb is tucked out of sight. Position across the
   * knuckles survives that: the thumb tip of an A sits beside the index knuckle,
   * a T pokes out between index and middle, an N between middle and ring, an M
   * beyond the ring.
   */
  thumbAcross: number;
  /**
   * Height of the thumb tip along the hand axis, in hand spans. The knuckle row
   * sits at roughly 1. An A's thumb rides up the side of the index finger; a
   * tucked thumb pokes through at or below the knuckles.
   */
  thumbAlong: number;
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
    axis: norm(sub(normalized[L.MIDDLE_MCP], normalized[L.WRIST])),
    pointing,
    indexMiddleCrossed,
    palmFacing: -palmNormal.z,
    fistness: 1 - (four[0] + four[1] + four[2] + four[3]) / 4,
  };
}
