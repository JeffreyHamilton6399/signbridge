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

  const toSample = (hand: HandFrame | undefined): HandSample | null => {
    if (!hand) return null;
    const wrist = hand.landmarks[HAND_LANDMARK.WRIST];
    const pos = body
      ? {
          x: ((wrist.x - body.originX) / body.scale) * flip,
          y: (wrist.y - body.originY) / body.scale,
          z: wrist.z / body.scale,
        }
      : { x: (wrist.x - 0.5) * flip, y: wrist.y - 0.5, z: wrist.z };
    return {
      // Handshape from world coordinates where available; location, just below,
      // stays in image space because that is where the body reference lives.
      geometry: geometryOf(hand, aspect),
      pos,
      zone: body ? zoneOf(pos.y) : 'unknown',
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
