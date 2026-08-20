/**
 * geometryOf() makes one decision — shape from world coordinates, orientation
 * from the image — and everything downstream of it inherits that decision, so
 * it is pinned here rather than left to be discovered from behaviour.
 */
import { describe, expect, it } from 'vitest';
import { geometryOf, handGeometry } from '@/features/handGeometry';
import { normalizeHand } from '@/features/normalize';
import type { HandFrame, Point3 } from '@/vision/types';

/** A flat right hand, fingers straight up, wrist at the origin. */
function flatHand(): Point3[] {
  const template: [number, number][] = [
    [0, 0],
    [-0.3, -0.2], [-0.5, -0.45], [-0.62, -0.65], [-0.7, -0.82],
    [-0.25, -0.9], [-0.28, -1.35], [-0.3, -1.6], [-0.32, -1.85],
    [0, -1], [0, -1.5], [0, -1.78], [0, -2.05],
    [0.25, -0.95], [0.3, -1.4], [0.32, -1.66], [0.34, -1.9],
    [0.48, -0.85], [0.56, -1.2], [0.6, -1.42], [0.63, -1.62],
  ];
  return template.map(([x, y]) => ({ x: 0.5 + x * 0.1, y: 0.7 + y * 0.1, z: 0 }));
}

/** The same hand closed: every fingertip folded back down onto the palm. */
function fistHand(): Point3[] {
  const pts = flatHand();
  const wrist = pts[0];
  // Fold each finger's PIP/DIP/TIP back toward the wrist, leaving the knuckles
  // where they are. That is what a curl looks like to chainStraightness.
  for (const [pip, dip, tip] of [
    [6, 7, 8],
    [10, 11, 12],
    [14, 15, 16],
    [18, 19, 20],
  ]) {
    const mcp = pts[pip - 1];
    pts[pip] = { x: mcp.x, y: mcp.y - 0.035, z: 0.02 };
    pts[dip] = { x: mcp.x, y: mcp.y - 0.02, z: 0.045 };
    pts[tip] = { x: mcp.x, y: mcp.y + 0.01, z: 0.05 };
  }
  void wrist;
  return pts;
}

function rotate180(points: Point3[]): Point3[] {
  const wrist = points[0];
  return points.map((p) => ({
    x: 2 * wrist.x - p.x,
    y: 2 * wrist.y - p.y,
    z: p.z,
  }));
}

function hand(landmarks: Point3[], world?: Point3[]): HandFrame {
  return { landmarks, world, handedness: 'Right', handednessScore: 0.98 };
}

describe('geometryOf', () => {
  it('matches the old image-space path when no world landmarks arrive', () => {
    const landmarks = flatHand();
    const expected = handGeometry(
      normalizeHand(landmarks, 'Right', { aspect: 1.5 }),
      normalizeHand(landmarks, 'Right', { aspect: 1.5, canonicalRotation: false }),
    );
    const actual = geometryOf(hand(landmarks), 1.5);
    expect(actual.four).toEqual(expected.four);
    expect(actual.thumbAcross).toBeCloseTo(expected.thumbAcross, 10);
    expect(actual.pointing).toBeCloseTo(expected.pointing, 10);
  });

  it('reads handshape from world landmarks when they are present', () => {
    // The projection says the fingers are curled; the metric landmarks say they
    // are straight. This is the everyday case of a hand angled toward the lens,
    // and getting it wrong is what makes D, L and G fall apart off-axis.
    const flat = geometryOf(hand(fistHand(), flatHand()));
    const projected = geometryOf(hand(fistHand()));
    expect(flat.four.every((e) => e > 0.8)).toBe(true);
    expect(projected.four.every((e) => e < 0.2)).toBe(true);
  });

  it('still takes pointing direction from the image, not from world space', () => {
    // World coordinates are hand-centred: they cannot tell P from K, or Q from
    // G, because those differ only by which way the hand points in the frame.
    const upright = geometryOf(hand(flatHand(), flatHand()));
    const inverted = geometryOf(hand(rotate180(flatHand()), flatHand()));
    expect(upright.pointing).toBeGreaterThan(0.9);
    expect(inverted.pointing).toBeLessThan(-0.9);
    // ...while the handshape they report is identical, because it is the same
    // hand and it came from the same world landmarks.
    expect(inverted.four).toEqual(upright.four);
  });

  it('agrees with the image path for a hand square on to the camera', () => {
    // The letter thresholds were tuned against image-space geometry, so this is
    // the check that they carry over rather than needing a re-tune: for a
    // frontal hand, where the projection is faithful, world landmarks are a
    // uniform scaling of the image ones — and every quantity here is measured
    // in hand spans, so scale drops out.
    const landmarks = flatHand();
    const world = landmarks.map((p) => ({
      x: (p.x - 0.5) * 0.42,
      y: (p.y - 0.7) * 0.42,
      z: p.z * 0.42,
    }));
    const before = geometryOf(hand(landmarks));
    const after = geometryOf(hand(landmarks, world));
    expect(after.four).toEqual(before.four);
    expect(after.thumbAcross).toBeCloseTo(before.thumbAcross, 9);
    expect(after.thumbAlong).toBeCloseTo(before.thumbAlong, 9);
    expect(after.gapIndexMiddle).toBeCloseTo(before.gapIndexMiddle, 9);
    expect(after.thumbTo.index).toBeCloseTo(before.thumbTo.index, 9);
  });

  it('is unaffected by the frame aspect ratio once world landmarks exist', () => {
    const wide = geometryOf(hand(flatHand(), flatHand()), 1.78);
    const square = geometryOf(hand(flatHand(), flatHand()), 1);
    expect(wide.four).toEqual(square.four);
    expect(wide.gapIndexMiddle).toBeCloseTo(square.gapIndexMiddle, 10);
  });
});

/**
 * Where a finger's bend sits, computed from landmarks rather than from the
 * synthetic HandGeometry the template tests use. Fingers are built joint by
 * joint at known flexion angles, so the expected ratio is arithmetic rather
 * than a guess.
 */
describe('knuckleBend', () => {
  /**
   * One finger, bent by the given angles at knuckle, middle and end joints.
   * Straight up from the wrist, curling forward in the y/z plane.
   */
  function finger(x: number, angles: [number, number, number]): Point3[] {
    const lengths = [0.42, 0.28, 0.22];
    const out: Point3[] = [{ x, y: -1, z: 0 }];
    let cumulative = 0;
    let at = out[0];
    for (let i = 0; i < 3; i++) {
      cumulative += angles[i];
      at = {
        x,
        y: at.y - lengths[i] * Math.cos(cumulative),
        z: at.z + lengths[i] * Math.sin(cumulative),
      };
      out.push(at);
    }
    return out;
  }

  /** A whole hand whose index/middle/ring share one bend profile. */
  function handWith(angles: [number, number, number]): HandFrame {
    const thumb: Point3[] = [
      { x: -0.35, y: -0.25, z: 0.1 },
      { x: -0.5, y: -0.5, z: 0.15 },
      { x: -0.58, y: -0.7, z: 0.2 },
      { x: -0.62, y: -0.85, z: 0.24 },
    ];
    const landmarks: Point3[] = [
      { x: 0, y: 0, z: 0 },
      ...thumb,
      ...finger(-0.25, angles),
      ...finger(0, angles),
      ...finger(0.25, angles),
      ...finger(0.48, angles),
    ];
    return { landmarks, world: landmarks, handedness: 'Right', handednessScore: 0.98 };
  }

  // Knuckle share is angles[0] / sum(angles) by construction.
  const CLAW: [number, number, number] = [0.7, 1.8, 1.0];
  const FIST: [number, number, number] = [1.5, 1.6, 1.1];
  const DRAPE: [number, number, number] = [1.5, 0.9, 0.35];

  it('measures the share of bend at the knuckle', () => {
    expect(geometryOf(handWith(FIST)).curlBalance).toBeCloseTo(1.5 / 4.2, 2);
    expect(geometryOf(handWith(DRAPE)).curlBalance).toBeCloseTo(1.5 / 2.75, 2);
  });

  it('separates a claw, a fist and a draped hand', () => {
    const claw = geometryOf(handWith(CLAW)).curlBalance;
    const fist = geometryOf(handWith(FIST)).curlBalance;
    const drape = geometryOf(handWith(DRAPE)).curlBalance;
    // E, then A/S, then T/N/M: the axis the fist letters are ordered along.
    expect(claw).toBeLessThan(fist);
    expect(fist).toBeLessThan(drape);
  });

  it('counts fingers as draped only when they actually are', () => {
    // A soft count, not an integer one: a finger halfway into the band
    // contributes half. That is deliberate — the band is wide because the
    // reasoning behind it has not been checked against real signers, and a hard
    // count would turn every borderline finger into a confident wrong answer.
    expect(geometryOf(handWith(DRAPE)).drapedCount).toBeGreaterThan(2.2);
    expect(geometryOf(handWith(FIST)).drapedCount).toBeLessThan(0.2);
    expect(geometryOf(handWith(CLAW)).drapedCount).toBeLessThan(0.2);
  });

  it('stays neutral on an open hand, where the ratio means nothing', () => {
    // Nothing is bent, so the share is 0/0. Answering 0 would let a flat hand
    // vote against every letter that expects a draped finger.
    const open = geometryOf(handWith([0, 0, 0]));
    expect(open.curlBalance).toBeCloseTo(0.5, 5);
  });
});
