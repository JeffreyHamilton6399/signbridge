/**
 * Synthetic hand geometry and sign observations for tests.
 *
 * These build HandGeometry directly rather than synthesising landmarks and
 * running them through MediaPipe. That is deliberate: the thing under test is
 * the rule logic in handshapes.ts and signTemplates.ts, and a fake landmark
 * generator would mostly be testing how good the fake generator is.
 */
import type { HandGeometry, FingerState } from '@/features/handGeometry';
import type { Finger, Point3 } from '@/vision/types';
import { BODY_ANCHORS, NOMINAL_ANCHORS } from '@/modes/signs/observation';
import type { AnchorDistances, BodyAnchor, HandSample, HandTrack, SignObservation, Zone } from '@/modes/signs/observation';

const dir = (x = 0, y = 1, z = 0): Point3 => ({ x, y, z });

function finger(extension: number): FingerState {
  return {
    extension,
    // Straight finger ~pi at the PIP, curled ~1.2.
    pipAngle: 1.0 + extension * 2.0,
    direction: dir(),
    tip: { x: 0, y: 1 + extension, z: 0 },
  };
}

export interface GeometrySpec {
  /** thumb, index, middle, ring, pinky extension, 0..1 */
  ext?: [number, number, number, number, number];
  gapIndexMiddle?: number;
  gapMiddleRing?: number;
  gapRingPinky?: number;
  thumbToIndex?: number;
  thumbToMiddle?: number;
  thumbToRing?: number;
  thumbToPinky?: number;
  thumbAbduction?: number;
  thumbDepth?: number;
  /** Thumb tip across the knuckle line: 0 = index knuckle, 1 = pinky knuckle. */
  thumbAcross?: number;
  thumbAlong?: number;
  pointing?: number;
  indexMiddleCrossed?: boolean;
  /** Knuckle-bend share for index, middle, ring. Default: an ordinary fist. */
  knuckleBend?: [number, number, number];
  /** Fingertip clearance off the palm plane. Default: tips against the palm. */
  tipLift?: number;
}

/** A relaxed, half-open hand — nothing in particular. */
export function geometry(spec: GeometrySpec = {}): HandGeometry {
  const ext = spec.ext ?? [0.5, 0.5, 0.5, 0.5, 0.5];
  const fingers = {
    thumb: finger(ext[0]),
    index: finger(ext[1]),
    middle: finger(ext[2]),
    ring: finger(ext[3]),
    pinky: finger(ext[4]),
  } as Record<Finger, FingerState>;

  const four: [number, number, number, number] = [ext[1], ext[2], ext[3], ext[4]];

  return {
    fingers,
    four,
    gapIndexMiddle: spec.gapIndexMiddle ?? 0.3,
    gapMiddleRing: spec.gapMiddleRing ?? 0.3,
    gapRingPinky: spec.gapRingPinky ?? 0.3,
    thumbTo: {
      index: spec.thumbToIndex ?? 1.0,
      middle: spec.thumbToMiddle ?? 1.2,
      ring: spec.thumbToRing ?? 1.3,
      pinky: spec.thumbToPinky ?? 1.4,
    },
    thumbToIndexMcp: 0.8,
    thumbToPalm: 0.8,
    thumbAbduction: spec.thumbAbduction ?? 0.3,
    thumbDepth: spec.thumbDepth ?? 0,
    knuckleBend: [...(spec.knuckleBend ?? FIST_BEND), 0.35],
    curlBalance: mean(spec.knuckleBend ?? FIST_BEND),
    tipLift: spec.tipLift ?? 0.15,
    drapedCount: (spec.knuckleBend ?? FIST_BEND).reduce(
      (a, b) => a + clamp01((b - 0.4) / 0.18),
      0,
    ),
    thumbAcross: spec.thumbAcross ?? 0,
    thumbAlong: spec.thumbAlong ?? 1.2,
    palmFacing: 1,
    axis: dir(),
    pointing: spec.pointing ?? 1,
    indexMiddleCrossed: spec.indexMiddleCrossed ?? false,
    fistness: 1 - (four[0] + four[1] + four[2] + four[3]) / 4,
  };
}

/** Canonical handshapes, matching the predicates in features/handshapes.ts. */
export const SHAPES = {
  flat: () => geometry({ ext: [0.2, 0.95, 0.95, 0.95, 0.9], gapIndexMiddle: 0.2, gapMiddleRing: 0.2 }),
  fist: () => geometry({ ext: [0.2, 0.05, 0.05, 0.05, 0.05], thumbToIndex: 0.7 }),
  flatO: () =>
    geometry({
      ext: [0.4, 0.5, 0.5, 0.5, 0.5],
      thumbToIndex: 0.25,
      thumbToMiddle: 0.4,
      gapIndexMiddle: 0.2,
    }),
  c: () => geometry({ ext: [0.85, 0.5, 0.5, 0.5, 0.5], thumbToIndex: 0.95 }),
  index: () => geometry({ ext: [0.2, 0.95, 0.05, 0.05, 0.05] }),
  ily: () => geometry({ ext: [0.9, 0.95, 0.05, 0.05, 0.9], thumbAbduction: 0.8 }),
  open: () =>
    geometry({
      ext: [0.9, 0.95, 0.95, 0.95, 0.95],
      gapIndexMiddle: 0.7,
      gapMiddleRing: 0.7,
      gapRingPinky: 0.7,
    }),
  claw: () =>
    geometry({ ext: [0.5, 0.5, 0.5, 0.5, 0.5], gapIndexMiddle: 0.7, gapMiddleRing: 0.6 }),
  h: () => geometry({ ext: [0.2, 0.95, 0.95, 0.05, 0.05], gapIndexMiddle: 0.2 }),
  v: () => geometry({ ext: [0.2, 0.95, 0.95, 0.05, 0.05], gapIndexMiddle: 0.85 }),
  w: () =>
    geometry({
      ext: [0.3, 0.95, 0.95, 0.95, 0.05],
      gapIndexMiddle: 0.6,
      gapMiddleRing: 0.6,
    }),
  y: () => geometry({ ext: [0.9, 0.05, 0.05, 0.05, 0.95], thumbToPinky: 2.0, thumbAbduction: 0.8 }),
  thumbUp: () => geometry({ ext: [0.9, 0.05, 0.05, 0.05, 0.05], thumbAbduction: 0.6 }),
  bent: () => geometry({ ext: [0.3, 0.5, 0.5, 0.5, 0.5], gapIndexMiddle: 0.2 }),
  l: () => geometry({ ext: [0.95, 0.95, 0.05, 0.05, 0.05], thumbAbduction: 0.85 }),
  f: () => geometry({ ext: [0.5, 0.3, 0.95, 0.95, 0.95], thumbToIndex: 0.25, gapMiddleRing: 0.35 }),
  babyO: () => geometry({ ext: [0.5, 0.1, 0.05, 0.05, 0.05], thumbToIndex: 0.25 }),
  x: () => geometry({ ext: [0.2, 0.5, 0.05, 0.05, 0.05], gapIndexMiddle: 0.2 }),
  three: () => geometry({ ext: [0.9, 0.95, 0.95, 0.05, 0.05], thumbAbduction: 0.7, gapIndexMiddle: 0.6 }),
  bentV: () => geometry({ ext: [0.2, 0.5, 0.5, 0.05, 0.05], gapIndexMiddle: 0.7 }),
  r: () => geometry({ ext: [0.2, 0.9, 0.9, 0.05, 0.05], gapIndexMiddle: 0.15, indexMiddleCrossed: true }),
  four: () => geometry({ ext: [0.2, 0.95, 0.95, 0.95, 0.95], gapIndexMiddle: 0.45, gapMiddleRing: 0.45, gapRingPinky: 0.45 }),
} as const;

// ---------------------------------------------------------------------------

/**
 * How far past the wrist the working end of the hand reaches, in shoulder
 * widths.
 *
 * The real pipeline measures anchor distance from the fingertips, thumb and
 * middle knuckle — whichever got closest — because that is what touches the
 * chin. A test case gives a wrist position, so this stands in for the rest of
 * the hand. Without it every canonical observation would read as holding its
 * hand a hand's-length away from the place the sign is made.
 *
 * Kept well under the spacing between neighbouring anchors. At 0.22 a hand at
 * the eye was also 'at' the ear — they sit 0.23 apart — so CRY and DEAF, HEAR
 * and THINK all collapsed into each other. A blur wider than the thing being
 * measured is not a measurement.
 */
const HAND_REACH = 0.14;
/** Distance that counts as touching. */
const TOUCHING = 0.04;

/**
 * Anchor distances for a hand at `pos`.
 *
 * Derived from {@link NOMINAL_ANCHORS} — the same table the real pipeline falls
 * back to when the pose face landmarks are not visible — so a canonical
 * observation and a real one mean the same thing by "at the chin". Pass `at` to
 * assert contact with one anchor explicitly rather than relying on the
 * position to imply it.
 */
function anchorDistances(pos: { x: number; y: number }, at?: BodyAnchor): AnchorDistances {
  const out = {} as AnchorDistances;
  for (const anchor of BODY_ANCHORS) {
    const n = NOMINAL_ANCHORS[anchor];
    const d = Math.hypot(pos.x - n.x, pos.y - n.y);
    out[anchor] = anchor === at ? TOUCHING : Math.max(TOUCHING, d - HAND_REACH);
  }
  return out;
}

export function sample(
  shape: HandGeometry,
  pos: { x: number; y: number },
  zone: Zone,
  at?: BodyAnchor,
): HandSample {
  return { geometry: shape, pos: { ...pos, z: 0 }, zone, near: anchorDistances(pos, at) };
}

export interface TrackSpec {
  shape: HandGeometry;
  /** Shape at the end, if it changes mid-sign. */
  endShape?: HandGeometry;
  zone: Zone;
  /** Zone at the first frame, when the hand travels between bands mid-sign. */
  startZone?: Zone;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  path?: number;
  reversals?: number;
  closedness?: number;
  roundness?: number;
  extent?: { x: number; y: number };
  /** Assert the hand touches this anchor at the start of the sign. */
  at?: BodyAnchor;
  /** Assert it touches this one at the end — DEAF runs ear to chin. */
  endAt?: BodyAnchor;
  /** Palm rotation over the window. + = turned to face front. */
  palmTurn?: number;
  /** Fingers tipping up (+) or down (-) over the window. */
  pointTurn?: number;
}

export function track(spec: TrackSpec): HandTrack {
  const from = spec.from ?? { x: 0, y: 0 };
  const to = spec.to ?? from;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const net = { x: to.x - from.x, y: to.y - from.y };
  const straightPath = Math.hypot(net.x, net.y);

  const start = sample(spec.shape, from, spec.startZone ?? spec.zone, spec.at);
  const midSample = sample(spec.shape, mid, spec.zone);
  const end = sample(spec.endShape ?? spec.shape, to, spec.zone, spec.endAt);
  // Closest approach across the window, matching observation.ts.
  const reached = {} as AnchorDistances;
  for (const anchor of BODY_ANCHORS) {
    reached[anchor] = Math.min(start.near[anchor], midSample.near[anchor], end.near[anchor]);
  }
  let nearestAnchor: BodyAnchor = 'chest';
  for (const anchor of BODY_ANCHORS) {
    if (reached[anchor] < reached[nearestAnchor]) nearestAnchor = anchor;
  }

  return {
    start,
    mid: midSample,
    end,
    net,
    path: spec.path ?? straightPath,
    extent: spec.extent ?? { x: Math.abs(net.x), y: Math.abs(net.y) },
    reversals: spec.reversals ?? 0,
    reached,
    nearestAnchor,
    palmTurn: spec.palmTurn ?? 0,
    pointTurn: spec.pointTurn ?? 0,
    closedness: spec.closedness ?? 0,
    roundness: spec.roundness ?? 0,
    zones: spec.startZone && spec.startZone !== spec.zone ? [spec.startZone, spec.zone] : [spec.zone],
    zoneStability: 1,
    dominantZone: spec.zone,
  };
}

export interface ObservationSpec {
  dominant: TrackSpec;
  other?: TrackSpec;
  handsContact?: boolean;
  contacts?: number;
  bodyUnknown?: boolean;
}

export function observation(spec: ObservationSpec): SignObservation {
  return {
    frames: 20,
    durationMs: 660,
    twoHanded: Boolean(spec.other),
    dominant: track(spec.dominant),
    other: spec.other ? track(spec.other) : null,
    minHandGap: spec.handsContact ? 0.2 : spec.other ? 1.2 : null,
    handsContact: spec.handsContact ?? false,
    contacts: spec.contacts ?? (spec.handsContact ? 1 : 0),
    bodyUnknown: spec.bodyUnknown ?? false,
  };
}

/**
 * Knuckle-bend share for an ordinary closed fist: the bend is spread across
 * every joint. Letters where the fingers lie over the thumb push this up; E,
 * where the fingertips reach down to meet a folded thumb, pushes it down.
 */
const FIST_BEND: [number, number, number] = [0.35, 0.35, 0.35];

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
