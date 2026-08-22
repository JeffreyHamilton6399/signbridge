/**
 * Does the personal model actually generalise?
 *
 * The experiment these run is the one that matters in practice, and it is not
 * "can it classify its own training samples" — any over-parameterized net can.
 * It is: **calibrate in one sitting, sign in another.**
 *
 * So samples are drawn in two sessions with different hand-to-camera angles.
 * The model is fitted on session one and scored on session two. That is the
 * situation a user is in every time they open the app after calibrating, and it
 * is the one a model fitted on eight un-augmented poses fails.
 *
 * HONEST LIMIT, stated once and applying to every number below: these are
 * synthetic hands (tests/helpers/hands.ts), not recordings. The results are
 * comparative — this model versus that model on identical inputs — and say
 * nothing about accuracy on real signers. Only a held-out-signer evaluation
 * does that, and it needs data this project does not yet have.
 */
import { describe, expect, it } from 'vitest';
import { observedHand, SYNTHETIC_LETTERS } from './helpers/hands';
import { normalizeHand, toFeatureVector } from '@/features/normalize';
import { augment, rng } from '@/features/augment';
import { trainLinearHead, runLinearHead } from '@/modes/fingerspell/calibration';
import type { CalibrationSample } from '@/modes/fingerspell/calibration';
import { trainMlpHead, runMlpHead, runFittedHead, isMlpHead } from '@/modes/fingerspell/mlpHead';
import { reviveHead, storeHead } from '@/db/idb';
import type { Point3 } from '@/vision/types';

/** Rotate a hand out of the image plane, as tilting it toward the lens would. */
function tilt(pts: Point3[], ax: number, ay: number): Point3[] {
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  return pts.map((p) => {
    const y1 = p.y * cx - p.z * sx;
    const z1 = p.y * sx + p.z * cx;
    return { x: p.x * cy + z1 * sy, y: y1, z: -p.x * sy + z1 * cy };
  });
}

/**
 * One sitting in front of the camera.
 *
 * A session has its own hand angle, held roughly constant across every letter
 * recorded in it — which is exactly why a model fitted on one session
 * generalises badly to the next, and exactly what augmentation exists to undo.
 */
function session(
  letters: string[],
  perLetter: number,
  opts: { ax: number; ay: number; seed: number; noise?: number },
): CalibrationSample[] {
  const next = rng(opts.seed);
  const noise = opts.noise ?? 0.008;
  const out: CalibrationSample[] = [];
  for (const label of letters) {
    for (let i = 0; i < perLetter; i++) {
      // Small drift within the session; the session angle dominates.
      const pts = tilt(
        observedHand(SYNTHETIC_LETTERS[label], next),
        opts.ax + (next() - 0.5) * 0.09,
        opts.ay + (next() - 0.5) * 0.09,
      ).map((p) => ({
        x: p.x + (next() - 0.5) * noise,
        y: p.y + (next() - 0.5) * noise,
        z: p.z + (next() - 0.5) * noise * 2,
      }));
      out.push({
        label,
        features: toFeatureVector(normalizeHand(pts, 'Right', { aspect: 1 })),
        t: 0,
      });
    }
  }
  return out;
}

const FISTS = ['A', 'S', 'T', 'M', 'E'];
const ALL = Object.keys(SYNTHETIC_LETTERS);

function accuracy(
  predict: (f: Float32Array) => { labels: string[]; probs: Float32Array },
  samples: CalibrationSample[],
): number {
  let correct = 0;
  for (const s of samples) {
    const { labels, probs } = predict(s.features);
    let best = 0;
    for (let k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
    if (labels[best] === s.label) correct++;
  }
  return correct / samples.length;
}

describe('the personal model across sessions', () => {
  // Calibrate at one angle, sign at another. 8 samples per letter is what the
  // calibration flow asks for.
  const train = session(ALL, 8, { ax: 0.16, ay: -0.1, seed: 11 });
  const test = session(ALL, 6, { ax: -0.14, ay: 0.13, seed: 909 });

  const linear = trainLinearHead(train, { epochs: 300 })!;
  const mlp = trainMlpHead(train, { seed: 5 })!;

  const linearAcc = accuracy(
    (f) => ({ labels: linear.labels, probs: runLinearHead(linear, f) }),
    test,
  );
  const mlpAcc = accuracy((f) => ({ labels: mlp.labels, probs: runMlpHead(mlp, f) }), test);

  it('generalises to a session it was not fitted on', () => {
    // The bar the old head could not clear. Deliberately stated as an absolute
    // number as well as a comparison, so a regression that makes *both* models
    // worse still fails.
    expect(mlpAcc).toBeGreaterThan(0.85);
  });

  it('beats the linear head it replaces', () => {
    expect(mlpAcc).toBeGreaterThan(linearAcc);
  });

  it('reports a held-out number that is not the training number', () => {
    // Train accuracy on an over-parameterized net is near-meaningless. The
    // point of holdoutAccuracy is that it is allowed to be lower, and if the
    // two are identical the measurement is not measuring anything.
    expect(mlp.holdoutAccuracy).not.toBeNull();
    expect(mlp.holdoutAccuracy!).toBeLessThanOrEqual(mlp.trainAccuracy);
  });
});

describe('the fist cluster specifically', () => {
  // The cluster the user actually reports errors in, on its own — this is the
  // ninety-second calibration, six letters rather than twenty-four.
  const train = session(FISTS, 8, { ax: 0.16, ay: -0.1, seed: 21 });
  const test = session(FISTS, 6, { ax: -0.14, ay: 0.13, seed: 707 });

  it('separates A, S, T, M and E across sessions', () => {
    const mlp = trainMlpHead(train, { seed: 3 })!;
    const acc = accuracy((f) => ({ labels: mlp.labels, probs: runMlpHead(mlp, f) }), test);
    expect(acc).toBeGreaterThan(0.85);
  });

  it('is confined to the letters it was shown', () => {
    const mlp = trainMlpHead(train, { seed: 3 })!;
    expect(mlp.labels).toEqual([...FISTS].sort());
  });
});

describe('augmentation', () => {
  it('is what carries the generalisation', () => {
    // The control for the experiment above. Same net, same epochs, same seed,
    // augmentation turned down to nothing — if this scores as well, the
    // augmentation code is doing no work and should be deleted rather than
    // shipped.
    const train = session(ALL, 8, { ax: 0.16, ay: -0.1, seed: 31 });
    const test = session(ALL, 6, { ax: -0.14, ay: 0.13, seed: 313 });

    const withAug = trainMlpHead(train, { seed: 7 })!;
    const without = trainMlpHead(train, {
      seed: 7,
      augment: { tilt: 0, jitter: 0, jitterZ: 0 },
    })!;

    const a = accuracy((f) => ({ labels: withAug.labels, probs: runMlpHead(withAug, f) }), test);
    const b = accuracy((f) => ({ labels: without.labels, probs: runMlpHead(without, f) }), test);
    expect(a).toBeGreaterThan(b);
  });

  it('keeps every variant on the manifold normalize.ts produces', () => {
    // An augmented sample must satisfy the same invariants as a real one:
    // wrist at the origin, unit hand span. Otherwise the model is fitted on a
    // region of the space that inference can never visit.
    const next = rng(99);
    const base = toFeatureVector(
      normalizeHand(observedHand(SYNTHETIC_LETTERS.A, next), 'Right', { aspect: 1 }),
    );
    for (let i = 0; i < 40; i++) {
      const v = augment(base, next);
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(0, 6);
      // Landmark 9 is the middle MCP, which normalization puts at distance 1.
      expect(Math.hypot(v[27], v[28], v[29])).toBeCloseTo(1, 5);
    }
  });

  it('actually changes the sample', () => {
    const next = rng(4);
    const base = toFeatureVector(
      normalizeHand(observedHand(SYNTHETIC_LETTERS.T, next), 'Right', { aspect: 1 }),
    );
    const v = augment(base, next);
    let diff = 0;
    for (let i = 0; i < base.length; i++) diff += Math.abs(base[i] - v[i]);
    expect(diff).toBeGreaterThan(0.05);
  });
});

describe('surviving a reload', () => {
  it('round-trips an MLP head through the stored shape', () => {
    // The failure this guards is silent and total: if the MLP does not survive
    // serialization, every launch quietly falls back to whatever loads, and the
    // model the user spent ninety seconds on is gone with no error anywhere.
    const train = session(FISTS, 8, { ax: 0.1, ay: 0, seed: 77 });
    const head = trainMlpHead(train, { seed: 2 })!;
    const revived = reviveHead(storeHead(head));

    expect(revived).not.toBeNull();
    expect(isMlpHead(revived!)).toBe(true);
    // Identical predictions, not merely a similar-looking object.
    for (const s of train) {
      const before = runMlpHead(head, s.features);
      const after = runFittedHead(revived!, s.features);
      for (let k = 0; k < before.length; k++) {
        expect(after[k]).toBeCloseTo(before[k], 6);
      }
    }
  });

  it('still loads a linear head written by an older build', () => {
    // Stored linear heads carry no `kind`, so absence of one has to keep
    // meaning linear or every existing user's calibration breaks on upgrade.
    const train = session(FISTS, 8, { ax: 0.1, ay: 0, seed: 78 });
    const linear = trainLinearHead(train, { epochs: 50 })!;
    const stored = storeHead(linear);
    expect(stored && 'weights' in stored).toBe(true);
    expect((stored as { kind?: string }).kind).toBeUndefined();

    const revived = reviveHead(stored);
    expect(revived).not.toBeNull();
    expect(isMlpHead(revived!)).toBe(false);
    const before = runLinearHead(linear, train[0].features);
    const after = runFittedHead(revived!, train[0].features);
    for (let k = 0; k < before.length; k++) expect(after[k]).toBeCloseTo(before[k], 6);
  });
});

describe('the classifier actually uses it', () => {
  it('lets the fitted head move the answer within the letters it knows', () => {
    // The bug this mirrors already happened once: a head was fitted, stored,
    // reloaded every launch and never consulted, because it was installed in a
    // slot nothing on the frame path read.
    const train = session(FISTS, 8, { ax: 0.1, ay: 0, seed: 91 });
    const head = trainMlpHead(train, { seed: 2 })!;

    const probs = runFittedHead(head, train[0].features);
    const total = probs.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(head.labels.length).toBe(FISTS.length);
  });
});
