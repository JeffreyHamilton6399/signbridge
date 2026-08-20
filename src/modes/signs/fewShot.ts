/**
 * Few-shot custom signs.
 *
 * The user records ~8 examples of a sign; we average them into a prototype and
 * match new windows by nearest centroid in the same feature space the shipped
 * temporal model uses. This is what lets people add their own name sign, local
 * signs, and workplace jargon - the things no dataset will ever contain.
 *
 * It is also, today, the *only* sign recogniser in the app. Phase 2's shipped
 * 150-sign model needs a licensed dataset and a training run (see /training);
 * until that model exists, custom signs give sign mode real, honest behaviour
 * rather than a fake vocabulary. See docs/MODELS.md.
 */
import { squaredDistance, meanVector } from '@/features/normalize';
import { PER_FRAME_DIM, WINDOW_DIM, WINDOW_FRAMES } from '@/features/window';
import type { CustomSign } from '@/db/idb';

/** Examples the recording flow asks for before it will build a prototype. */
export const SAMPLES_PER_SIGN = 8;

export interface SignMatch {
  label: string;
  id: string;
  /** 0..1. Derived from distance; not a calibrated probability. */
  confidence: number;
  distance: number;
}

export interface Prototype {
  id: string;
  label: string;
  centroid: Float32Array;
  /** Mean within-class distance; wide classes get a wider acceptance band. */
  spread: number;
  sampleCount: number;
}

export function buildPrototype(id: string, label: string, samples: Float32Array[]): Prototype | null {
  const centroid = meanVector(samples);
  if (!centroid) return null;
  const spread =
    samples.reduce((acc, s) => acc + squaredDistance(s, centroid), 0) / Math.max(1, samples.length);
  return { id, label, centroid, spread, sampleCount: samples.length };
}

export function prototypeFromStored(sign: CustomSign): Prototype | null {
  if (sign.centroid.length !== WINDOW_DIM) return null;
  const samples = sign.samples.map((s) => Float32Array.from(s));
  return buildPrototype(sign.id, sign.label, samples.length ? samples : [Float32Array.from(sign.centroid)]);
}

export function toStored(prototype: Prototype, samples: Float32Array[]): CustomSign {
  return {
    id: prototype.id,
    label: prototype.label,
    samples: samples.map((s) => [...s]),
    centroid: [...prototype.centroid],
    featureDim: PER_FRAME_DIM,
    frames: WINDOW_FRAMES,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Nearest-centroid matcher with an explicit rejection band.
 *
 * The rejection band is the "no sign / transition" class the master prompt
 * insists on, expressed as a distance cutoff instead of a trained class: when
 * the closest prototype is further away than its own examples typically are,
 * we return null rather than the least-bad guess. Without this the recogniser
 * fires constantly while the signer is just moving between signs.
 */
export class FewShotMatcher {
  private prototypes: Prototype[] = [];
  /** Multiplier on a class's own spread that still counts as a match. */
  private rejectionFactor: number;

  constructor(prototypes: Prototype[] = [], rejectionFactor = 2.4) {
    this.prototypes = prototypes;
    this.rejectionFactor = rejectionFactor;
  }

  setPrototypes(prototypes: Prototype[]): void {
    this.prototypes = prototypes;
  }

  get size(): number {
    return this.prototypes.length;
  }

  get labels(): string[] {
    return this.prototypes.map((p) => p.label);
  }

  match(window: Float32Array, topK = 3): SignMatch[] {
    if (this.prototypes.length === 0) return [];

    const scored = this.prototypes
      .map((p) => {
        const distance = squaredDistance(window, p.centroid);
        // A generous floor keeps a single-sample prototype from claiming a
        // spread of zero and rejecting everything.
        const band = Math.max(p.spread, 1e-3) * this.rejectionFactor;
        const confidence = Math.max(0, 1 - distance / (band * 2));
        return { id: p.id, label: p.label, distance, confidence, band };
      })
      .sort((a, b) => a.distance - b.distance);

    const best = scored[0];
    if (best.distance > best.band) return [];

    return scored.slice(0, topK).map(({ id, label, distance, confidence }) => ({
      id,
      label,
      distance,
      confidence,
    }));
  }
}

/**
 * Deciding where a sign starts and ends.
 *
 * This matters more than the templates do. Everything downstream — handshape,
 * location, direction of travel — is computed over the window this produces, so
 * a window that starts halfway through a sign or runs on into the next one
 * produces garbage no rule can rescue.
 *
 * ## Why the thresholds are learned, not fixed
 *
 * Motion energy is measured in normalized landmark units, which sounds
 * device-independent and is not: it scales with how much of the frame the
 * signer fills, how noisy the landmarks are in the current lighting, and how
 * much the person moves while at rest. A threshold tuned on one setup silently
 * fails on another — either never triggering, or triggering constantly.
 *
 * So the segmenter watches the quiet periods and learns what "still" looks like
 * here, then triggers on a real departure from it. Hysteresis (a lower bar to
 * stop than to start) stops it flickering at the boundary.
 */
export class SignSegmenter {
  private active: Float32Array[] = [];
  private energies: number[] = [];
  private quietFrames = 0;
  private busyFrames = 0;

  /** EMA of energy while at rest — the noise floor for this person and scene. */
  private baseline = 0;
  /** EMA of absolute deviation from the baseline. */
  private deviation = 0;
  private samples = 0;

  constructor(
    /** Departures above baseline + this many deviations start a sign. */
    private startSigmas = 3.5,
    /** Below baseline + this many deviations counts as quiet again. */
    private stopSigmas = 1.5,
    private minFrames = 6,
    private quietFramesToEnd = 5,
  ) {}

  reset(): void {
    this.active = [];
    this.energies = [];
    this.quietFrames = 0;
    this.busyFrames = 0;
  }

  /** Forget the learned noise floor — after a camera or resolution change. */
  recalibrate(): void {
    this.reset();
    this.baseline = 0;
    this.deviation = 0;
    this.samples = 0;
  }

  get recording(): boolean {
    return this.active.length > 0;
  }

  /** True once enough quiet has been seen to trust the thresholds. */
  get calibrated(): boolean {
    return this.samples >= 15;
  }

  get startThreshold(): number {
    // The absolute floor stops a perfectly still scene from setting the bar so
    // low that landmark jitter reads as signing.
    return Math.max(0.012, this.baseline + this.startSigmas * this.deviation);
  }

  get stopThreshold(): number {
    return Math.max(0.006, this.baseline + this.stopSigmas * this.deviation);
  }

  /**
   * @param handPresent false when no hand is in frame. A sign cannot start
   *   without one, and one already running ends.
   * @returns the completed window when a sign just ended, otherwise null.
   */
  push(frame: Float32Array, energy: number, handPresent = true): Float32Array[] | null {
    if (this.active.length === 0) {
      // Only learn the floor while idle; learning during a sign would drag the
      // threshold up until nothing ever triggers again.
      this.learn(energy);

      if (!handPresent || !this.calibrated) {
        this.busyFrames = 0;
        return null;
      }
      if (energy > this.startThreshold) {
        this.busyFrames++;
        // Two consecutive busy frames, so a single noisy frame cannot open a
        // window.
        if (this.busyFrames >= 2) {
          this.active = [frame];
          this.energies = [energy];
          this.quietFrames = 0;
        }
      } else {
        this.busyFrames = 0;
      }
      return null;
    }

    this.active.push(frame);
    this.energies.push(energy);

    // A hand leaving the frame ends the sign immediately — waiting for the
    // quiet count would tack the empty frames onto the window.
    if (!handPresent) return this.finish(0);

    if (energy < this.stopThreshold) this.quietFrames++;
    else this.quietFrames = 0;

    if (this.quietFrames >= this.quietFramesToEnd) return this.finish(this.quietFrames);

    // Runaway guard: nobody signs one lexical item for four seconds.
    if (this.active.length > 120) return this.finish(0);

    return null;
  }

  private learn(energy: number): void {
    if (this.samples === 0) {
      this.baseline = energy;
      this.deviation = energy * 0.5;
      this.samples = 1;
      return;
    }
    // Slow, so a hand passing through frame does not move the floor much.
    const alpha = this.samples < 30 ? 0.1 : 0.02;
    const delta = energy - this.baseline;
    this.baseline += alpha * delta;
    this.deviation += alpha * (Math.abs(delta) - this.deviation);
    this.samples++;
  }

  /**
   * Close the window, trimming the trailing quiet.
   *
   * The trailing frames are the hand coming to rest, which is not part of the
   * sign and drags the "where did it end up" measurements toward the rest
   * position — the difference between GOOD ending on the palm and GOOD ending
   * wherever the hand dropped afterwards.
   */
  private finish(trailingQuiet: number): Float32Array[] | null {
    const end = Math.max(0, this.active.length - trailingQuiet);
    const window = this.active.slice(0, end);
    const peak = this.energies.length ? Math.max(...this.energies) : 0;
    const threshold = this.startThreshold;
    this.reset();

    if (window.length < this.minFrames) return null;
    // A window that only just cleared the bar and never got going is a hand
    // being repositioned, not a sign. Requiring a real peak is what keeps
    // scratching your nose out of the transcript.
    if (peak < threshold * 1.35) return null;
    return window;
  }
}
