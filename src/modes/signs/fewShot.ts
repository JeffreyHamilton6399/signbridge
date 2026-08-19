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
 * Segments a continuous stream into candidate sign windows.
 *
 * Energy rises when a sign starts and falls at its end; we emit the frames
 * between those two moments. Crude compared to a CTC head, but it is honest,
 * runs in microseconds, and does not pretend to segment continuous signing -
 * that is Phase 4's problem, behind an experimental flag.
 */
export class SignSegmenter {
  private active: Float32Array[] = [];
  private quietFrames = 0;
  private busyFrames = 0;

  constructor(
    private startEnergy = 0.035,
    private stopEnergy = 0.018,
    private minFrames = 8,
    private quietFramesToEnd = 6,
  ) {}

  reset(): void {
    this.active = [];
    this.quietFrames = 0;
    this.busyFrames = 0;
  }

  get recording(): boolean {
    return this.active.length > 0;
  }

  /**
   * @returns the completed window when a sign just ended, otherwise null.
   */
  push(frame: Float32Array, energy: number): Float32Array[] | null {
    if (this.active.length === 0) {
      if (energy > this.startEnergy) {
        this.busyFrames++;
        // Two consecutive busy frames before starting, so a single noisy frame
        // does not open a window.
        if (this.busyFrames >= 2) {
          this.active = [frame];
          this.quietFrames = 0;
        }
      } else {
        this.busyFrames = 0;
      }
      return null;
    }

    this.active.push(frame);
    if (energy < this.stopEnergy) this.quietFrames++;
    else this.quietFrames = 0;

    if (this.quietFrames >= this.quietFramesToEnd) {
      const window = this.active.slice(0, -this.quietFrames);
      this.reset();
      return window.length >= this.minFrames ? window : null;
    }

    // Runaway guard: nobody signs one lexical item for four seconds.
    if (this.active.length > WINDOW_FRAMES * 2) {
      const window = this.active.slice();
      this.reset();
      return window;
    }
    return null;
  }
}
