/**
 * What personalization is actually allowed to do.
 *
 * Two invariants, both of which were broken:
 *
 *   1. A model fitted on some letters must leave the others alone. The
 *      prototype blend used to scale every letter down and add the personal
 *      mass back only to the calibrated ones, so a half-finished calibration
 *      handed a third of all probability to whichever letters happened to get
 *      recorded — someone who stopped partway through was making the app worse.
 *   2. The fitted head must be consulted at all. It was routed through the
 *      async ONNX slot, which nothing on the frame path calls, so it was
 *      trained, stored, and never once used to classify anything.
 */
import { describe, expect, it } from 'vitest';
import { FingerspellClassifier, featuresFor } from '@/modes/fingerspell/classifier';
import { buildPrototypes, trainLinearHead } from '@/modes/fingerspell/calibration';
import type { CalibrationSample } from '@/modes/fingerspell/calibration';
import { FIST_CLUSTER } from '@/modes/fingerspell/letterTemplates';
import { spread } from '@/modes/fingerspell/useFingerspell';
import type { HandFrame, Point3 } from '@/vision/types';

/** A closed fist, near enough for a test that never asserts which letter wins. */
function fist(): HandFrame {
  const template: [number, number][] = [
    [0, 0],
    [-0.3, -0.2], [-0.5, -0.45], [-0.6, -0.62], [-0.66, -0.78],
    [-0.25, -0.9], [-0.28, -1.2], [-0.2, -1.0], [-0.14, -0.82],
    [0, -1], [0, -1.3], [0.02, -1.06], [0.03, -0.86],
    [0.25, -0.95], [0.3, -1.24], [0.26, -1.0], [0.24, -0.82],
    [0.48, -0.85], [0.56, -1.1], [0.5, -0.9], [0.46, -0.74],
  ];
  const landmarks: Point3[] = template.map(([x, y]) => ({ x: 0.5 + x * 0.1, y: 0.6 + y * 0.1, z: 0 }));
  return { landmarks, world: landmarks, handedness: 'Right', handednessScore: 0.98 };
}

/** Deterministic jitter, so a sample set is varied without being random. */
function jitter(base: Float32Array, seed: number, scale = 0.01): Float32Array {
  const out = Float32Array.from(base);
  for (let i = 0; i < out.length; i++) out[i] += Math.sin(seed * 7.13 + i * 1.31) * scale;
  return out;
}

/**
 * Eight samples of each fist letter. `target` gets samples that look like the
 * hand under test; the rest get samples that look like something else, so the
 * fitted head has a real preference to express.
 */
function fistSamples(target: string, like: Float32Array): CalibrationSample[] {
  const out: CalibrationSample[] = [];
  FIST_CLUSTER.forEach((label, classIndex) => {
    for (let i = 0; i < 8; i++) {
      const base =
        label === target
          ? jitter(like, i)
          : jitter(
              like.map((v) => v + (classIndex + 1) * 0.35) as unknown as Float32Array,
              i + 100,
            );
      out.push({ label, features: base, t: 0 });
    }
  });
  return out;
}

const OUTSIDE = ['B', 'C', 'D', 'L', 'V', 'W', 'Y'];

describe('a calibration that covers only some letters', () => {
  const hand = fist();
  const like = featuresFor(hand);
  const samples = fistSamples('T', like);

  it('leaves the letters it has never seen exactly as they were', () => {
    const classifier = new FingerspellClassifier();
    const before = classifier.predict(hand).distribution;

    classifier.setPrototypes(buildPrototypes(samples));
    classifier.setLocalHead(trainLinearHead(samples));
    const after = classifier.predict(hand).distribution;

    for (const letter of OUTSIDE) {
      expect(after[letter]).toBeCloseTo(before[letter], 12);
    }
  });

  it('redistributes within the cluster rather than inflating it', () => {
    const classifier = new FingerspellClassifier();
    const before = classifier.predict(hand).distribution;
    const clusterBefore = FIST_CLUSTER.reduce((a, l) => a + before[l], 0);

    classifier.setPrototypes(buildPrototypes(samples));
    classifier.setLocalHead(trainLinearHead(samples));
    const after = classifier.predict(hand).distribution;
    const clusterAfter = FIST_CLUSTER.reduce((a, l) => a + after[l], 0);

    expect(clusterAfter).toBeCloseTo(clusterBefore, 6);
  });

  it('still sums to one', () => {
    const classifier = new FingerspellClassifier();
    classifier.setPrototypes(buildPrototypes(samples));
    classifier.setLocalHead(trainLinearHead(samples));
    const total = Object.values(classifier.predict(hand).distribution).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('the fitted head', () => {
  const hand = fist();
  const like = featuresFor(hand);

  it('reaches the frame path, not just storage', () => {
    // predict() is what the fingerspelling loop calls. If the head is only
    // consulted by predictAsync — which nothing calls — this does not move.
    const classifier = new FingerspellClassifier();
    const samples = fistSamples('T', like);
    classifier.setPrototypes(buildPrototypes(samples));
    const withoutHead = classifier.predict(hand).distribution;

    classifier.setLocalHead(trainLinearHead(samples));
    const withHead = classifier.predict(hand).distribution;

    expect(withHead.T).not.toBeCloseTo(withoutHead.T, 6);
  });

  it('picks the letter it was taught this hand is', () => {
    for (const target of ['T', 'M', 'N'] as const) {
      const classifier = new FingerspellClassifier();
      const samples = fistSamples(target, like);
      classifier.setPrototypes(buildPrototypes(samples));
      classifier.setLocalHead(trainLinearHead(samples));

      const dist = classifier.predict(hand).distribution;
      const best = [...FIST_CLUSTER].sort((a, b) => dist[b] - dist[a])[0];
      expect(best).toBe(target);
    }
  });

  it('says nothing until it has seen enough of every letter it knows', () => {
    // One sample per class does not generalise, it memorises — and because it
    // memorises perfectly it comes out almost one-hot, confident enough to
    // override the prototypes even at a low blend weight. Hence a floor rather
    // than only a ramp.
    const classifier = new FingerspellClassifier();
    const thin = fistSamples('T', like).filter((_, i) => i % 8 === 0);
    classifier.setPrototypes(buildPrototypes(thin));
    const withoutHead = classifier.predict(hand).distribution;

    classifier.setLocalHead(trainLinearHead(thin));
    const withHead = classifier.predict(hand).distribution;

    expect(withHead.T).toBeCloseTo(withoutHead.T, 12);
  });
});

describe('spread', () => {
  it('returns everything when there is less than asked for', () => {
    expect(spread([1, 2], 3)).toEqual([1, 2]);
  });

  it('takes the ends and the middle', () => {
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 4, 8]);
  });

  it('never returns the same frame twice from a long buffer', () => {
    const picked = spread([...Array(40).keys()], 3);
    expect(new Set(picked).size).toBe(3);
  });
});
