/**
 * Turning a window of frames into something a rule can read.
 *
 * A sign is four things at once: handshape, location on or near the body,
 * movement, and orientation. The raw landmark stream carries all of them but in
 * a form nothing can be written against. This module summarises a window into
 * named quantities — "flat hand", "at the chin", "moved outward", "tapped twice"
 * — so signTemplates.ts reads like a description of the sign rather than
 * arithmetic.
 *
 * Location is measured relative to the shoulders, not the frame, because
 * location is phonemic in ASL: the same handshape at the chin and at the chest
 * are different signs, and that has to survive the signer sitting closer to the
 * camera.
 */
import type { HandFrame, Point3, VisionFrame } from '@/vision/types';
import type { HandGeometry } from '@/features/handGeometry';
import { geometryOf } from '@/features/handGeometry';
import { bodyFrame } from '@/features/window';
import { HAND_LANDMARK } from '@/vision/types';

/**
 * Vertical bands of the body, in shoulder-widths above/below the shoulder line.
 * Rough human proportions: chin sits ~0.5 above, forehead ~0.9, chest ~0.4
 * below. Bands are generous because signers vary and pose landmarks are noisy.
 */
export type Zone = 'head' | 'face' | 'neck' | 'chest' | 'waist' | 'unknown';

export function zoneOf(y: number | null): Zone {
  if (y === null || Number.isNaN(y)) return 'unknown';
  if (y < -0.78) return 'head';
  if (y < -0.34) return 'face';
  if (y < -0.04) return 'neck';
  if (y < 0.62) return 'chest';
  return 'waist';
}

/**
 * Named places on the body that a sign can be made *at*.
 *
 * WHY ZONES WERE NOT ENOUGH
 * -------------------------
 * Location is phonemic in ASL, and until now it was read as one of five
 * horizontal bands plus how far off the midline the hand sat. That is a
 * genuinely coarse instrument. WATER is a W hand tapping the chin, MOTHER is an
 * open hand at the chin, DEAF runs from the ear to the chin, and THINK touches
 * the temple — and every one of those is "the face band, somewhere". The rules
 * were reduced to guessing from handshape and movement alone, and the signs
 * that share a handshape with a neighbour had nothing left to stand on.
 *
 * MediaPipe's pose model already returns the nose, eyes, ears and mouth corners.
 * They were being discarded: `bodyFrame` keeps the two shoulders and throws the
 * rest away. These anchors are those landmarks, put into body space, plus a few
 * derived from them by proportion.
 *
 * WHAT "AT" MEANS
 * ---------------
 * Distance is measured from the closest business end of the hand — fingertips,
 * thumb, and the middle knuckle — not from the wrist. Which part of the hand
 * touches varies by sign (WATER taps with the fingertips, MOTHER with the
 * thumb), and the wrist is most of a hand-length away from all of them.
 */
export type BodyAnchor =
  | 'forehead'
  | 'temple'
  | 'eye'
  | 'ear'
  | 'nose'
  | 'mouth'
  | 'chin'
  | 'cheek'
  | 'neck'
  | 'shoulder'
  | 'chest'
  | 'waist';

export const BODY_ANCHORS: readonly BodyAnchor[] = [
  'forehead', 'temple', 'eye', 'ear', 'nose', 'mouth',
  'chin', 'cheek', 'neck', 'shoulder', 'chest', 'waist',
];

/**
 * Where each anchor sits in body space when the face is not visible.
 *
 * Origin is the shoulder midpoint, unit is shoulder width, +y is down, +x is
 * outward on the dominant side. The proportions are ordinary adult ones and
 * they are what the zone bands in {@link zoneOf} already assume.
 *
 * This is a fallback and also the definition tests are written against, so that
 * a canonical observation and a real one mean the same thing by "at the chin".
 * Pose face landmarks are used in preference whenever they are actually there —
 * they are the measurement, this is the estimate.
 */
export const NOMINAL_ANCHORS: Record<BodyAnchor, { x: number; y: number }> = {
  forehead: { x: 0.0, y: -1.02 },
  // The temple sits at the side of the brow; the ear is lower and further back.
  // These were 0.18 apart, which is barely more than the hand's own reach — so
  // a hand at one was nearly as close to the other, and HEAR (an index finger
  // at the ear) could only tell itself from THINK by a margin of 0.008.
  // Anchors closer together than the thing measuring them cannot be told apart.
  temple: { x: 0.29, y: -0.98 },
  eye: { x: 0.16, y: -0.86 },
  ear: { x: 0.42, y: -0.76 },
  nose: { x: 0.0, y: -0.7 },
  mouth: { x: 0.0, y: -0.56 },
  chin: { x: 0.0, y: -0.44 },
  cheek: { x: 0.3, y: -0.6 },
  neck: { x: 0.0, y: -0.2 },
  shoulder: { x: 0.5, y: 0.0 },
  chest: { x: 0.0, y: 0.3 },
  waist: { x: 0.0, y: 0.95 },
};

/** Distance, in shoulder widths, from the hand to each anchor. */
export type AnchorDistances = Record<BodyAnchor, number>;

/** Anchor distances for a hand that is nowhere near the body. */
export const NO_ANCHORS: AnchorDistances = Object.fromEntries(
  BODY_ANCHORS.map((a) => [a, 9]),
) as AnchorDistances;

export interface HandSample {
  geometry: HandGeometry;
  /**
   * Wrist in body space. Origin is the shoulder midpoint, unit is shoulder
   * width, +y is downward.
   *
   * +x always points *outward on the dominant side*, for either handedness: the
   * whole scene is mirrored for a right-handed signer. That way a rule can say
   * "moves away from the body" once instead of twice.
   */
  pos: { x: number; y: number; z: number };
  zone: Zone;
  /**
   * How close the hand came to each named place on the body, this frame.
   * See {@link BodyAnchor}. Large values everywhere means the hand is out in
   * neutral space, which is itself a location a sign can be made in.
   */
  near: AnchorDistances;
}

export interface SignFrame {
  t: number;
  dominant: HandSample | null;
  other: HandSample | null;
  /** Wrist-to-wrist distance in shoulder widths, or null when a hand is missing. */
  handGap: number | null;
  /** True when the body reference could not be established (no pose). */
  bodyUnknown: boolean;
}

/**
 * Build one frame's sample. Cheap enough to run at frame rate: two
 * normalizations and two geometry passes, a few microseconds in total.
 */
/** MediaPipe pose indices for the face. "Left" is the subject's left. */
const POSE = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
} as const;

type Flat = { x: number; y: number };

const mid = (a: Flat, b: Flat): Flat => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** a, extended past b by `t` of the a-to-b distance. */
const beyond = (a: Flat, b: Flat, t: number): Flat => ({
  x: b.x + (b.x - a.x) * t,
  y: b.y + (b.y - a.y) * t,
});

/**
 * Anchor positions in body space, from the pose face landmarks when they are
 * there and from {@link NOMINAL_ANCHORS} when they are not.
 *
 * Falling back per-anchor rather than all-or-nothing: the mouth corners drop out
 * far more often than the shoulders do, and losing the mouth is no reason to
 * stop knowing where the chest is.
 */
function anchorsFor(pose: Point3[] | null, toBody: (p: Flat) => Flat, flip: number): Record<BodyAnchor, Flat> {
  const nominal = () => {
    const out = {} as Record<BodyAnchor, Flat>;
    for (const a of BODY_ANCHORS) out[a] = NOMINAL_ANCHORS[a];
    return out;
  };
  if (!pose || pose.length <= POSE.RIGHT_SHOULDER) return nominal();

  const at = (i: number): Flat | null => {
    const p = pose[i];
    // Pose landmarks carry a visibility score; a low one means the model is
    // extrapolating, and an extrapolated ear is worse than an assumed one.
    if (!p) return null;
    const v = (p as Point3 & { visibility?: number }).visibility;
    if (v !== undefined && v < 0.5) return null;
    return toBody(p);
  };

  const out = nominal();
  const nose = at(POSE.NOSE);
  // The dominant side's own ear and eye. flip is -1 for a right-dominant
  // signer, whose dominant-side ear is the RIGHT one — getting this backwards
  // put the temple and cheek on the wrong side of the head, which is a mistake
  // no synthetic HandSample can catch because it never goes through here.
  const dominantIsRight = flip < 0;
  const earSame = at(dominantIsRight ? POSE.RIGHT_EAR : POSE.LEFT_EAR);
  const eyeSame = at(dominantIsRight ? POSE.RIGHT_EYE : POSE.LEFT_EYE);
  const eyeL = at(POSE.LEFT_EYE);
  const eyeR = at(POSE.RIGHT_EYE);
  const mouthL = at(POSE.MOUTH_LEFT);
  const mouthR = at(POSE.MOUTH_RIGHT);

  const eyes = eyeL && eyeR ? mid(eyeL, eyeR) : (eyeSame ?? null);
  const mouth = mouthL && mouthR ? mid(mouthL, mouthR) : null;

  if (nose) out.nose = nose;
  if (eyes) out.eye = eyes;
  if (earSame) out.ear = earSame;
  if (mouth) out.mouth = mouth;
  // Forehead and chin are off the top and bottom of the measured face, by
  // proportion. Both are common sign locations and neither is a landmark.
  if (mouth && eyes) {
    out.forehead = beyond(mouth, eyes, 0.55);
    out.chin = beyond(eyes, mouth, 0.42);
  }
  if (eyeSame && earSame) out.temple = beyond(eyeSame, earSame, -0.25);
  if (earSame && mouth) out.cheek = mid(earSame, mouth);
  return out;
}

/** Distance from the working end of a hand to a point, in shoulder widths. */
function handReach(hand: HandFrame, toBody: (p: Flat) => Flat, target: Flat): number {
  // The wrist is most of a hand-length from whatever is doing the touching, and
  // which part touches varies by sign — WATER taps with the fingertips, MOTHER
  // with the thumb. Take whichever part of the hand got closest.
  let best = Infinity;
  for (const index of REACH_POINTS) {
    const p = toBody(hand.landmarks[index]);
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < best) best = d;
  }
  return best;
}

const REACH_POINTS = [
  HAND_LANDMARK.INDEX_TIP,
  HAND_LANDMARK.MIDDLE_TIP,
  HAND_LANDMARK.THUMB_TIP,
  HAND_LANDMARK.MIDDLE_MCP,
];

export function sampleFrame(frame: VisionFrame, dominantHand: 'Left' | 'Right'): SignFrame {
  const aspect = frame.height > 0 ? frame.width / frame.height : 1;
  const body = bodyFrame(frame.pose, aspect);

  const dominantRaw = frame.hands.find((hnd) => hnd.handedness === dominantHand) ?? frame.hands[0];
  const otherRaw = frame.hands.find((hnd) => hnd !== dominantRaw);

  // A right-handed signer facing the camera has their dominant hand on the
  // viewer's left, so image x runs the wrong way. Mirroring the whole scene
  // preserves the geometry between the hands and lets every rule be written
  // once, in signer space, with +x meaning "outward on the dominant side".
  const flip = dominantHand === 'Right' ? -1 : 1;

  // Image point to body space: shoulder midpoint at the origin, shoulder width
  // as the unit, mirrored so +x is outward on the dominant side.
  const toBody = (p: Flat): Flat =>
    body
      ? { x: ((p.x - body.originX) / body.scale) * flip, y: (p.y - body.originY) / body.scale }
      : { x: (p.x - 0.5) * flip, y: p.y - 0.5 };

  const anchors = body ? anchorsFor(frame.pose, toBody, flip) : null;

  const toSample = (hand: HandFrame | undefined): HandSample | null => {
    if (!hand) return null;
    const wrist = hand.landmarks[HAND_LANDMARK.WRIST];
    const flat = toBody(wrist);
    const pos = { x: flat.x, y: flat.y, z: body ? wrist.z / body.scale : wrist.z };

    let near = NO_ANCHORS;
    if (anchors) {
      near = {} as AnchorDistances;
      for (const anchor of BODY_ANCHORS) {
        near[anchor] = handReach(hand, toBody, anchors[anchor]);
      }
    }

    return {
      // Handshape from world coordinates where available; location, just below,
      // stays in image space because that is where the body reference lives.
      geometry: geometryOf(hand, aspect),
      pos,
      zone: body ? zoneOf(pos.y) : 'unknown',
      near,
    };
  };

  const dominant = toSample(dominantRaw);
  const other = toSample(otherRaw);

  return {
    t: frame.t,
    dominant,
    other,
    handGap:
      dominant && other
        ? Math.hypot(dominant.pos.x - other.pos.x, dominant.pos.y - other.pos.y)
        : null,
    bodyUnknown: body === null,
  };
}

// ---------------------------------------------------------------------------
// Window summary
// ---------------------------------------------------------------------------

export interface HandTrack {
  start: HandSample;
  mid: HandSample;
  end: HandSample;
  /** Net displacement over the window, in shoulder widths. */
  net: { x: number; y: number };
  /** Total distance travelled. Large net/path ratio means a straight move. */
  path: number;
  /** Extent of the movement on each axis. */
  extent: { x: number; y: number };
  /** Direction reversals along the busier axis. 2+ means a repeated movement. */
  reversals: number;
  /** 0 = straight line, 1 = returned exactly to where it started. */
  closedness: number;
  /** 0 = movement confined to one axis, 1 = equal on both (a circle or arc). */
  roundness: number;
  /**
   * How far the palm rotated over the window. + = turned to face the signer's
   * front, - = turned away. Roughly -2..2; anything past about 0.7 is a
   * deliberate twist rather than drift.
   *
   * Orientation is the fourth parameter of a sign, alongside handshape,
   * location and movement, and until this existed the recogniser tracked three
   * of them. That is not a rounding error in coverage — a whole class of signs
   * is *defined* by the rotation and is otherwise identical to another sign.
   * BOOK is two flat palms that open; without rotation it is a pair of flat
   * hands in contact, which is also SCHOOL, MONEY and half a dozen others.
   */
  palmTurn: number;
  /**
   * How far the fingers tipped between pointing up and pointing down, over the
   * window. + = tipped up, - = tipped down. Same scale and reasoning as
   * {@link palmTurn}; this is the other half of orientation.
   */
  pointTurn: number;
  /**
   * Closest the hand came to each body anchor at any point in the window.
   *
   * Closest rather than average, because contact is an event: DEAF touches the
   * ear and then the chin, and averaging would say it was never quite at
   * either. A sign that stays somewhere is caught by this too — it just gets
   * there and remains.
   */
  reached: AnchorDistances;
  /** The anchor the hand was closest to overall, and how close. */
  nearestAnchor: BodyAnchor;
  /** Every zone the hand passed through, in order of first visit. */
  zones: Zone[];
  /** Fraction of frames in the single most-occupied zone. */
  zoneStability: number;
  /** Most-occupied zone. */
  dominantZone: Zone;
}

export interface SignObservation {
  frames: number;
  durationMs: number;
  twoHanded: boolean;
  dominant: HandTrack | null;
  other: HandTrack | null;
  /** Closest the wrists came, in shoulder widths. */
  minHandGap: number | null;
  /** Wrists came within touching distance at some point. */
  handsContact: boolean;
  /** Times the hands came together and separated again — taps and claps. */
  contacts: number;
  /** No pose was available, so every location is a guess. Rules bail out on this. */
  bodyUnknown: boolean;
}

/** Wrist separation below this counts as the hands touching. */
const CONTACT_GAP = 0.42;
/** Movement below this on an axis is landmark jitter, not a reversal. */
const JITTER = 0.045;

function buildTrack(samples: HandSample[]): HandTrack | null {
  if (samples.length === 0) return null;
  const start = samples[0];
  const end = samples[samples.length - 1];
  const mid = samples[Math.floor(samples.length / 2)];

  let path = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i].pos;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    if (i > 0) {
      const q = samples[i - 1].pos;
      path += Math.hypot(p.x - q.x, p.y - q.y);
    }
  }

  const extent = { x: maxX - minX, y: maxY - minY };
  const net = { x: end.pos.x - start.pos.x, y: end.pos.y - start.pos.y };
  const netLength = Math.hypot(net.x, net.y);

  // Count reversals on whichever axis actually moved.
  const axis: 'x' | 'y' = extent.x >= extent.y ? 'x' : 'y';
  let reversals = 0;
  let direction = 0;
  let anchor = samples[0].pos[axis];
  for (const sample of samples) {
    const delta = sample.pos[axis] - anchor;
    if (Math.abs(delta) < JITTER) continue;
    const next = Math.sign(delta);
    if (direction !== 0 && next !== direction) reversals++;
    direction = next;
    anchor = sample.pos[axis];
  }

  const reached = {} as AnchorDistances;
  for (const anchor of BODY_ANCHORS) {
    let best = Infinity;
    for (const s of samples) best = Math.min(best, s.near[anchor]);
    reached[anchor] = best;
  }
  let nearestAnchor: BodyAnchor = 'chest';
  for (const anchor of BODY_ANCHORS) {
    if (reached[anchor] < reached[nearestAnchor]) nearestAnchor = anchor;
  }

  const zoneCounts = new Map<Zone, number>();
  const zones: Zone[] = [];
  for (const sample of samples) {
    zoneCounts.set(sample.zone, (zoneCounts.get(sample.zone) ?? 0) + 1);
    if (!zones.includes(sample.zone)) zones.push(sample.zone);
  }
  let dominantZone: Zone = 'unknown';
  let bestCount = 0;
  for (const [zone, count] of zoneCounts) {
    if (count > bestCount) {
      bestCount = count;
      dominantZone = zone;
    }
  }

  return {
    start,
    mid,
    end,
    net,
    path,
    extent,
    reversals,
    reached,
    nearestAnchor,
    // Measured start to end rather than as a total swing: what distinguishes
    // these signs is which way the palm ends up facing, not how much it wobbled
    // getting there.
    palmTurn: end.geometry.palmFacing - start.geometry.palmFacing,
    pointTurn: end.geometry.pointing - start.geometry.pointing,
    closedness: path > 1e-4 ? Math.max(0, 1 - netLength / path) : 0,
    roundness:
      Math.max(extent.x, extent.y) > 1e-4
        ? Math.min(extent.x, extent.y) / Math.max(extent.x, extent.y)
        : 0,
    zones,
    zoneStability: samples.length ? bestCount / samples.length : 0,
    dominantZone,
  };
}

export function observe(frames: readonly SignFrame[]): SignObservation | null {
  if (frames.length < 3) return null;

  const dominantSamples = frames.map((f) => f.dominant).filter((s): s is HandSample => s !== null);
  const otherSamples = frames.map((f) => f.other).filter((s): s is HandSample => s !== null);

  const gaps = frames.map((f) => f.handGap).filter((g): g is number => g !== null);
  const minHandGap = gaps.length ? Math.min(...gaps) : null;

  // A contact is a dip below the threshold followed by a rise back above it.
  let contacts = 0;
  let touching = false;
  for (const gap of gaps) {
    if (!touching && gap < CONTACT_GAP) {
      touching = true;
      contacts++;
    } else if (touching && gap > CONTACT_GAP * 1.5) {
      touching = false;
    }
  }

  return {
    frames: frames.length,
    durationMs: frames[frames.length - 1].t - frames[0].t,
    // Both hands present for most of the window, not just a stray frame.
    twoHanded: otherSamples.length > frames.length * 0.6,
    dominant: buildTrack(dominantSamples),
    other: buildTrack(otherSamples),
    minHandGap,
    handsContact: minHandGap !== null && minHandGap < CONTACT_GAP,
    contacts,
    bodyUnknown: frames.every((f) => f.bodyUnknown),
  };
}

/** Human-readable summary, for the debug overlay. */
export function describe(observation: SignObservation): string {
  const d = observation.dominant;
  if (!d) return 'no hand';
  const direction =
    Math.abs(d.net.x) > Math.abs(d.net.y)
      ? d.net.x > 0.1
        ? 'right'
        : d.net.x < -0.1
          ? 'left'
          : 'still'
      : d.net.y > 0.1
        ? 'down'
        : d.net.y < -0.1
          ? 'up'
          : 'still';
  return [
    observation.twoHanded ? 'two hands' : 'one hand',
    `at ${d.dominantZone}`,
    `moving ${direction}`,
    d.reversals >= 2 ? `${d.reversals} reversals` : null,
    observation.handsContact ? `${observation.contacts} contact(s)` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export type { Point3 };
