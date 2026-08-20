/**
 * Landmark smoothing — the 1€ filter, applied to the raw landmark stream.
 *
 * WHY THIS IS A LATENCY FEATURE, NOT A COSMETIC ONE
 * -------------------------------------------------
 * MediaPipe's per-frame output jitters by a pixel or two even on a hand that is
 * not moving. That jitter reads to a person as *lag*, because a skeleton that
 * shivers around the hand looks like it is chasing it. It also costs accuracy:
 * every geometric feature the letter and sign rules are written against is a
 * ratio of small distances, so a jittering fingertip flickers the classifier
 * between neighbouring letters, and the dwell timer keeps restarting.
 *
 * The naive fix — averaging the last N frames — trades that jitter for real
 * lag, which is worse. The 1€ filter (Casiez, Roussel & Vogel, CHI 2012) does
 * not: its cutoff frequency rises with the measured speed of the point, so a
 * still hand is filtered hard and a moving hand is barely filtered at all. You
 * get a steady skeleton at rest and a responsive one in motion, which is
 * exactly the pair of properties this app needs.
 *
 * Pure math, no DOM, no timers. The caller supplies frame timestamps.
 */
import type { Handedness, HandFrame, Point3, VisionFrame } from '@/vision/types';

export type SmoothingLevel = 'off' | 'light' | 'standard' | 'strong';

export interface OneEuroParams {
  /**
   * Cutoff frequency at zero speed, in Hz. Lower means a stiller hand at rest
   * and more lag when movement starts.
   */
  minCutoff: number;
  /**
   * How fast the cutoff opens up with speed. Higher means less lag while
   * moving, at the cost of letting more jitter through during movement — where
   * nobody can see it anyway.
   */
  beta: number;
  /** Cutoff for the speed estimate itself. Rarely worth changing. */
  derivativeCutoff: number;
}

/**
 * Presets, tuned for landmarks in the 0..1 image-normalized range at 20-30fps.
 *
 * A hand crossing the frame in half a second moves at roughly 2 units/second,
 * so beta values of a few units are what make the cutoff actually open during
 * ordinary signing rather than only during a lunge.
 */
export const SMOOTHING_PRESETS: Record<Exclude<SmoothingLevel, 'off'>, OneEuroParams> = {
  light: { minCutoff: 3.2, beta: 6, derivativeCutoff: 1.2 },
  standard: { minCutoff: 1.7, beta: 4, derivativeCutoff: 1 },
  strong: { minCutoff: 0.9, beta: 2.5, derivativeCutoff: 1 },
};

/** A hand not seen for this long is treated as new, not as having teleported. */
const REACQUIRE_MS = 250;

function alphaFor(dtSeconds: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

/** One scalar channel. */
class Channel {
  private value = 0;
  private derivative = 0;
  private primed = false;

  reset(): void {
    this.primed = false;
    this.derivative = 0;
  }

  filter(x: number, dt: number, p: OneEuroParams): number {
    if (!this.primed) {
      this.primed = true;
      this.value = x;
      this.derivative = 0;
      return x;
    }
    const rawDerivative = (x - this.value) / dt;
    this.derivative +=
      alphaFor(dt, p.derivativeCutoff) * (rawDerivative - this.derivative);
    const cutoff = p.minCutoff + p.beta * Math.abs(this.derivative);
    this.value += alphaFor(dt, cutoff) * (x - this.value);
    return this.value;
  }
}

/** A fixed-length list of 3D points, filtered independently per axis. */
export class PointSetFilter {
  private channels: Channel[] = [];
  private lastT = 0;
  /** Separate from lastT, because t === 0 is a legitimate timestamp. */
  private started = false;

  reset(): void {
    for (const c of this.channels) c.reset();
    this.started = false;
  }

  /**
   * @param points  this frame's raw points
   * @param t       capture timestamp, ms
   * @param params  filter tuning
   */
  filter(points: readonly Point3[], t: number, params: OneEuroParams): Point3[] {
    const needed = points.length * 3;
    if (this.channels.length !== needed) {
      this.channels = Array.from({ length: needed }, () => new Channel());
      this.started = false;
    }

    // A gap means the hand left and came back; a velocity computed across it
    // would fling the filtered points across the frame.
    const gap = this.started ? t - this.lastT : Infinity;
    if (gap > REACQUIRE_MS || gap <= 0) {
      for (const c of this.channels) c.reset();
    }
    // Guard against a zero or absurd dt: both make alpha meaningless.
    const dt = Math.min(0.2, Math.max(0.004, (Number.isFinite(gap) ? gap : 33) / 1000));
    this.lastT = t;
    this.started = true;

    return points.map((p, i) => ({
      x: this.channels[i * 3].filter(p.x, dt, params),
      y: this.channels[i * 3 + 1].filter(p.y, dt, params),
      z: this.channels[i * 3 + 2].filter(p.z, dt, params),
    }));
  }
}

/**
 * Smooths a whole VisionFrame, keeping a separate filter per tracked hand.
 *
 * Hands are keyed by handedness, because that is the only stable identity
 * MediaPipe gives us. When it reports two hands with the same label — which it
 * does occasionally, and wrongly — the second one gets its own slot rather than
 * fighting the first for the same filter state.
 */
export class FrameSmoother {
  private hands = new Map<string, { landmarks: PointSetFilter; world: PointSetFilter }>();
  private pose = new PointSetFilter();
  private seen = new Set<string>();

  reset(): void {
    this.hands.clear();
    this.pose.reset();
  }

  smooth(frame: VisionFrame, level: SmoothingLevel): VisionFrame {
    if (level === 'off') return frame;
    const params = SMOOTHING_PRESETS[level];

    this.seen.clear();
    const hands: HandFrame[] = frame.hands.map((hand) => {
      const key = slotFor(this.seen, hand.handedness);
      let slot = this.hands.get(key);
      if (!slot) {
        slot = { landmarks: new PointSetFilter(), world: new PointSetFilter() };
        this.hands.set(key, slot);
      }
      return {
        ...hand,
        landmarks: slot.landmarks.filter(hand.landmarks, frame.t, params),
        world: hand.world ? slot.world.filter(hand.world, frame.t, params) : hand.world,
      };
    });

    // Drop filters for hands that are no longer in frame, so a hand returning
    // after a long absence starts clean instead of easing in from where it was.
    for (const key of [...this.hands.keys()]) {
      if (!this.seen.has(key)) this.hands.delete(key);
    }

    return {
      ...frame,
      hands,
      // Pose moves slowly and its landmarks are noticeably noisier than the
      // hand model's, so it benefits from the same treatment.
      pose: frame.pose ? this.pose.filter(frame.pose, frame.t, params) : frame.pose,
    };
  }
}

function slotFor(seen: Set<string>, handedness: Handedness): string {
  let key: string = handedness;
  let n = 1;
  while (seen.has(key)) key = `${handedness}#${++n}`;
  seen.add(key);
  return key;
}
