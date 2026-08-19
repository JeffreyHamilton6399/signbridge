/**
 * Normalization is the contract every model is trained against, so these tests
 * are the specification rather than a smoke check. If one of them fails, a
 * trained model is now invalid - bump the feature version, do not loosen the
 * assertion.
 */
import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  dist,
  handCentroid,
  handSpan,
  meanVector,
  normalizeHand,
  squaredDistance,
  toFeatureVector,
} from '@/features/normalize';
import { HAND_LANDMARK } from '@/vision/types';
import type { Point3 } from '@/vision/types';

/** A flat right hand, fingers up, at a known position and scale. */
function syntheticHand(scale = 0.1, originX = 0.5, originY = 0.8): Point3[] {
  // Wrist at origin, middle MCP one unit "up" (negative y in image space),
  // fingers splayed above it.
  const template: [number, number][] = [
    [0, 0], // 0 wrist
    [-0.3, -0.2], [-0.5, -0.45], [-0.62, -0.65], [-0.7, -0.82], // thumb
    [-0.25, -0.9], [-0.28, -1.35], [-0.3, -1.6], [-0.32, -1.85], // index
    [0, -1], [0, -1.5], [0, -1.78], [0, -2.05], // middle
    [0.25, -0.95], [0.3, -1.4], [0.32, -1.66], [0.34, -1.9], // ring
    [0.48, -0.85], [0.56, -1.2], [0.6, -1.42], [0.63, -1.62], // pinky
  ];
  return template.map(([x, y]) => ({
    x: originX + x * scale,
    y: originY + y * scale,
    z: 0,
  }));
}

function translate(points: Point3[], dx: number, dy: number): Point3[] {
  return points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

function rotate(points: Point3[], radians: number, cx: number, cy: number): Point3[] {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((p) => {
    const x = p.x - cx;
    const y = p.y - cy;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos, z: p.z };
  });
}

describe('handSpan', () => {
  it('measures wrist to middle-MCP', () => {
    const hand = syntheticHand(0.1);
    expect(handSpan(hand)).toBeCloseTo(0.1, 6);
  });

  it('falls back to knuckle width when the hand is degenerate', () => {
    const collapsed: Point3[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    collapsed[HAND_LANDMARK.INDEX_MCP] = { x: 0.4, y: 0.5, z: 0 };
    collapsed[HAND_LANDMARK.PINKY_MCP] = { x: 0.6, y: 0.5, z: 0 };
    expect(handSpan(collapsed)).toBeCloseTo(0.2, 6);
  });

  it('never returns zero', () => {
    const collapsed: Point3[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(handSpan(collapsed)).toBe(1);
  });
});

describe('normalizeHand', () => {
  it('puts the wrist at the origin', () => {
    const out = normalizeHand(syntheticHand(), 'Right');
    expect(out[HAND_LANDMARK.WRIST].x).toBeCloseTo(0, 10);
    expect(out[HAND_LANDMARK.WRIST].y).toBeCloseTo(0, 10);
  });

  it('scales the hand to unit span', () => {
    const out = normalizeHand(syntheticHand(0.05), 'Right');
    expect(dist(out[HAND_LANDMARK.WRIST], out[HAND_LANDMARK.MIDDLE_MCP])).toBeCloseTo(1, 6);
  });

  it('rotates the wrist-to-middle-MCP axis onto +y', () => {
    const out = normalizeHand(syntheticHand(), 'Right');
    const ref = out[HAND_LANDMARK.MIDDLE_MCP];
    expect(ref.x).toBeCloseTo(0, 6);
    expect(ref.y).toBeCloseTo(1, 6);
  });

  it('is invariant to where the hand sits in frame', () => {
    const a = toFeatureVector(normalizeHand(syntheticHand(0.1, 0.3, 0.4), 'Right'));
    const b = toFeatureVector(normalizeHand(syntheticHand(0.1, 0.75, 0.9), 'Right'));
    expect(squaredDistance(a, b)).toBeLessThan(1e-10);
  });

  it('is invariant to distance from the camera', () => {
    const near = toFeatureVector(normalizeHand(syntheticHand(0.2), 'Right'));
    const far = toFeatureVector(normalizeHand(syntheticHand(0.05), 'Right'));
    expect(squaredDistance(near, far)).toBeLessThan(1e-10);
  });

  it('is invariant to hand roll', () => {
    const upright = syntheticHand();
    const tilted = rotate(upright, 0.6, 0.5, 0.8);
    const a = toFeatureVector(normalizeHand(upright, 'Right'));
    const b = toFeatureVector(normalizeHand(tilted, 'Right'));
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('maps a left hand into right-hand space', () => {
    const right = syntheticHand();
    const left = right.map((p) => ({ ...p, x: 1 - p.x }));
    const a = toFeatureVector(normalizeHand(right, 'Right'));
    const b = toFeatureVector(normalizeHand(left, 'Left'));
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('leaves left hands alone when mirroring is disabled', () => {
    const right = syntheticHand();
    const left = right.map((p) => ({ ...p, x: 1 - p.x }));
    const a = toFeatureVector(normalizeHand(right, 'Right', { mirrorLeft: false }));
    const b = toFeatureVector(normalizeHand(left, 'Left', { mirrorLeft: false }));
    expect(squaredDistance(a, b)).toBeGreaterThan(0.01);
  });

  it('corrects for a non-square frame', () => {
    // A 16:9 frame stretches x. Without correction the same physical hand
    // produces different features at different aspect ratios.
    const hand = syntheticHand();
    const corrected = toFeatureVector(normalizeHand(hand, 'Right', { aspect: 16 / 9 }));
    const uncorrected = toFeatureVector(normalizeHand(hand, 'Right', { aspect: 1 }));
    expect(squaredDistance(corrected, uncorrected)).toBeGreaterThan(0);
  });

  it('does not mutate its input', () => {
    const hand = syntheticHand();
    const snapshot = JSON.stringify(hand);
    normalizeHand(hand, 'Right');
    expect(JSON.stringify(hand)).toBe(snapshot);
  });

  it('produces 63 floats', () => {
    expect(toFeatureVector(normalizeHand(syntheticHand(), 'Right')).length).toBe(63);
  });
});

describe('handCentroid', () => {
  it('reports raw image coordinates, not normalized ones', () => {
    const hand = translate(syntheticHand(0.1, 0.5, 0.8), 0.2, 0);
    const centroid = handCentroid(hand);
    expect(centroid.x).toBeGreaterThan(0.6);
    expect(centroid.y).toBeGreaterThan(0);
    expect(centroid.y).toBeLessThan(1);
  });
});

describe('vector helpers', () => {
  it('cosineSimilarity of a vector with itself is 1', () => {
    const v = Float32Array.from([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('cosineSimilarity handles a zero vector without dividing by zero', () => {
    expect(cosineSimilarity(new Float32Array(4), Float32Array.from([1, 2, 3, 4]))).toBe(0);
  });

  it('meanVector averages elementwise', () => {
    const mean = meanVector([Float32Array.from([0, 2]), Float32Array.from([2, 4])]);
    expect([...mean!]).toEqual([1, 3]);
  });

  it('meanVector returns null for an empty set', () => {
    expect(meanVector([])).toBeNull();
  });
});
