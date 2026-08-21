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
import type { HandSample, HandTrack, SignObservation, Zone } from '@/modes/signs/observation';

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
} as const;

// ---------------------------------------------------------------------------

export function sample(shape: HandGeometry, pos: { x: number; y: number }, zone: Zone): HandSample {
  return { geometry: shape, pos: { ...pos, z: 0 }, zone };
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
}

export function track(spec: TrackSpec): HandTrack {
  const from = spec.from ?? { x: 0, y: 0 };
  const to = spec.to ?? from;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const net = { x: to.x - from.x, y: to.y - from.y };
  const straightPath = Math.hypot(net.x, net.y);

  return {
    start: sample(spec.shape, from, spec.startZone ?? spec.zone),
    mid: sample(spec.shape, mid, spec.zone),
    end: sample(spec.endShape ?? spec.shape, to, spec.zone),
    net,
    path: spec.path ?? straightPath,
    extent: spec.extent ?? { x: Math.abs(net.x), y: Math.abs(net.y) },
    reversals: spec.reversals ?? 0,
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
