/**
 * How good a look the camera is actually getting.
 *
 * Most recognition failures are not model failures. The hand is half out of
 * frame, or it is small and far away, or it is turned edge-on so the fingers
 * occlude each other, or it is moving too fast to be anything but a smear. In
 * every one of those cases the landmarks are still produced — MediaPipe always
 * produces landmarks — and they are still wrong, and the classifier still
 * returns its best guess with a confidence that does not know any of this.
 *
 * The honest response is to say what is wrong and decline to guess, not to
 * guess anyway and let the user work out why the letters are nonsense. So this
 * measures the input rather than the output, and the fingerspelling loop uses
 * it to *withhold* letters, never to inflate them.
 *
 * Every quantity is derived from the frame alone. Nothing here looks at what
 * the classifier said, because a check that consults the answer it is meant to
 * be checking is not a check.
 */
import type { HandFrame, VisionFrame } from '@/vision/types';
import { HAND_LANDMARK } from '@/vision/types';
import { handSpan } from './normalize';

export type ScanProblem = 'no-hand' | 'out-of-frame' | 'too-small' | 'too-fast' | 'edge-on';

export interface ScanQuality {
  /** 0..1. Nothing here is a probability; it is a usability score. */
  score: number;
  /** The worst thing about this frame, or null when it is fine. */
  problem: ScanProblem | null;
  /** What the user can do about it. Empty when there is nothing to say. */
  advice: string;
  /**
   * True when the input is too poor for a letter to mean anything. The
   * fingerspelling loop stops committing while this holds.
   */
  unusable: boolean;
}

export const GOOD_SCAN: ScanQuality = { score: 1, problem: null, advice: '', unusable: false };

/**
 * Hand span (wrist to middle knuckle) as a fraction of frame height, below
 * which there is not enough of a hand left to read a handshape off.
 *
 * At a normal desk distance a hand spans around 0.15 of the frame. 0.055 is
 * roughly twice arm's length — far enough that the fingers are a few pixels
 * each after the downscale to inference resolution.
 */
const MIN_SPAN = 0.055;
const COMFORTABLE_SPAN = 0.11;

/**
 * How far outside the frame a landmark may stray before it stops counting.
 *
 * MediaPipe extrapolates landmarks past the frame edge rather than clipping
 * them, so a hand half out of shot returns 21 confident-looking points, several
 * of which are invented. A small margin is tolerated because the extrapolation
 * is reasonable for a fingertip a hair over the edge.
 */
const EDGE_MARGIN = 0.02;

/** Wrist speed, in hand spans per second, past which a frame is a smear. */
const FAST = 6;
const VERY_FAST = 11;

/**
 * |palmFacing| below this means the hand is edge-on and the fingers are hiding
 * behind each other. Not fatal — some letters are signed at an angle — so it
 * only ever lowers the score, never marks a frame unusable.
 */
const EDGE_ON = 0.25;

const ADVICE: Record<ScanProblem, string> = {
  'no-hand': 'No hand in view',
  'out-of-frame': 'Bring your whole hand into view',
  'too-small': 'Move closer to the camera',
  'too-fast': 'Hold the shape still for a moment',
  'edge-on': 'Turn your palm toward the camera',
};

export interface ScanQualityInput {
  /** The hand being read, or undefined when there is none. */
  hand: HandFrame | undefined;
  frame: VisionFrame;
  /** Wrist speed in hand spans per second. See {@link ScanQualityTracker}. */
  speed: number;
  /** Palm normal toward the camera, from handGeometry. */
  palmFacing: number;
}

export function assessScan({ hand, frame, speed, palmFacing }: ScanQualityInput): ScanQuality {
  if (!hand) return problem('no-hand', 0);

  const aspect = frame.height > 0 ? frame.width / frame.height : 1;
  // Span is measured against frame *height* for both axes: the normalized
  // coordinate system stretches x by the aspect ratio, so comparing an x-ish
  // distance to 1.0 would call a wide frame's hand bigger than it is.
  const span = handSpan(hand.landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z })));

  let outside = 0;
  for (const p of hand.landmarks) {
    if (p.x < -EDGE_MARGIN || p.x > 1 + EDGE_MARGIN || p.y < -EDGE_MARGIN || p.y > 1 + EDGE_MARGIN) {
      outside++;
    }
  }
  // The wrist and the fingertips are what the rules are built on, so losing
  // several landmarks matters more than losing one.
  if (outside >= 3) return problem('out-of-frame', 0.15);

  if (span < MIN_SPAN) return problem('too-small', 0.2);
  if (speed > VERY_FAST) return problem('too-fast', 0.25);

  // Below here nothing is disqualifying; the frame is merely worse than ideal,
  // and the score says by how much.
  const sizeScore = ramp(span, MIN_SPAN, COMFORTABLE_SPAN);
  const speedScore = 1 - ramp(speed, FAST, VERY_FAST);
  const facingScore = ramp(Math.abs(palmFacing), 0, EDGE_ON);
  const framingScore = outside === 0 ? 1 : outside === 1 ? 0.75 : 0.5;
  const score = Math.min(sizeScore, speedScore, facingScore, framingScore);

  // Name the weakest link only when it is weak enough to be worth saying.
  let worst: ScanProblem | null = null;
  if (score < 0.6) {
    if (sizeScore === score) worst = 'too-small';
    else if (speedScore === score) worst = 'too-fast';
    else if (facingScore === score) worst = 'edge-on';
    else worst = 'out-of-frame';
  }

  return {
    score,
    problem: worst,
    advice: worst ? ADVICE[worst] : '',
    unusable: false,
  };
}

function problem(kind: ScanProblem, score: number): ScanQuality {
  return { score, problem: kind, advice: ADVICE[kind], unusable: true };
}

function ramp(v: number, lo: number, hi: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0;
  const t = (v - lo) / (hi - lo);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Wrist speed in hand spans per second, tracked across frames.
 *
 * In hand spans rather than image units so it means the same thing whether the
 * signer is close to the camera or far from it — the whole point is to know
 * whether the *hand* is moving fast relative to its own size, which is what
 * determines whether its fingers are a smear.
 */
export class ScanQualityTracker {
  private lastWrist: { x: number; y: number } | null = null;
  private lastT = 0;
  private lastId: number | undefined;
  private speed = 0;

  reset(): void {
    this.lastWrist = null;
    this.lastId = undefined;
    this.speed = 0;
  }

  /** Call once per frame with the hand being read. Returns its speed. */
  update(hand: HandFrame | undefined, t: number): number {
    if (!hand) {
      this.reset();
      return 0;
    }
    const wrist = hand.landmarks[HAND_LANDMARK.WRIST];
    const span = handSpan(hand.landmarks) || 1;
    const dt = (t - this.lastT) / 1000;

    // A different hand, or too long a gap, means there is no velocity to
    // measure — only the illusion of one.
    if (!this.lastWrist || hand.id !== this.lastId || dt <= 0 || dt > 0.4) {
      this.speed = 0;
    } else {
      const moved = Math.hypot(wrist.x - this.lastWrist.x, wrist.y - this.lastWrist.y) / span;
      // Smoothed, because a single dropped frame otherwise reads as a lunge.
      this.speed = this.speed * 0.6 + (moved / dt) * 0.4;
    }

    this.lastWrist = { x: wrist.x, y: wrist.y };
    this.lastT = t;
    this.lastId = hand.id;
    return this.speed;
  }
}
