/**
 * The 1€ filter has one job with two halves, and both halves have to hold or it
 * is not worth having: kill jitter on a hand that is still, and stay out of the
 * way of a hand that is moving. A filter that only does the first is a moving
 * average, and a moving average is exactly the lag this replaced.
 */
import { describe, expect, it } from 'vitest';
import {
  FrameSmoother,
  PointSetFilter,
  SMOOTHING_PRESETS,
} from '@/features/smoothing';
import type { Point3, VisionFrame } from '@/vision/types';

const STANDARD = SMOOTHING_PRESETS.standard;

/**
 * Deterministic broadband noise, so a flaky seed can never make this pass.
 *
 * It has to be broadband: a smooth sinusoid at 2Hz is, as far as a 1€ filter is
 * concerned, a hand that is genuinely moving, and it will correctly decline to
 * remove it. Tracker jitter is frame-to-frame and uncorrelated, which is the
 * thing this filter is for and the thing an LCG produces.
 */
function makeNoise(): () => number {
  let seed = 0x2f6e2b1;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 0.008;
  };
}

function points(x: number, y: number): Point3[] {
  return [{ x, y, z: 0 }];
}

/** Root-mean-square deviation from a constant. */
function rms(values: number[], about: number): number {
  const total = values.reduce((acc, v) => acc + (v - about) ** 2, 0);
  return Math.sqrt(total / values.length);
}

describe('PointSetFilter', () => {
  it('passes the first sample through untouched', () => {
    const filter = new PointSetFilter();
    const out = filter.filter(points(0.4, 0.6), 0, STANDARD);
    expect(out[0].x).toBeCloseTo(0.4, 10);
    expect(out[0].y).toBeCloseTo(0.6, 10);
  });

  it('suppresses jitter on a stationary point', () => {
    const filter = new PointSetFilter();
    const noise = makeNoise();
    const raw: number[] = [];
    const filtered: number[] = [];
    for (let i = 0; i < 60; i++) {
      const x = 0.5 + noise();
      raw.push(x);
      filtered.push(filter.filter(points(x, 0.5), i * 33, STANDARD)[0].x);
    }
    // Ignore the first few frames while the filter primes.
    const rawRms = rms(raw.slice(10), 0.5);
    const filteredRms = rms(filtered.slice(10), 0.5);
    expect(filteredRms).toBeLessThan(rawRms * 0.5);
  });

  it('keeps up with a fast move instead of dragging behind it', () => {
    const filter = new PointSetFilter();
    let out = 0;
    // 1.2 units/second — a hand crossing the frame in under a second.
    for (let i = 0; i < 30; i++) {
      const x = 0.1 + (i * 33 * 1.2) / 1000;
      out = filter.filter(points(x, 0.5), i * 33, STANDARD)[0].x;
    }
    const truth = 0.1 + (29 * 33 * 1.2) / 1000;
    // Within one frame's worth of travel: the cutoff has opened up.
    expect(Math.abs(out - truth)).toBeLessThan((1.2 * 33) / 1000);
  });

  it('lags less at speed than it does at rest', () => {
    const slow = new PointSetFilter();
    const fast = new PointSetFilter();
    let slowOut = 0;
    let fastOut = 0;
    let slowTruth = 0;
    let fastTruth = 0;
    for (let i = 0; i < 20; i++) {
      slowTruth = 0.1 + i * 0.002;
      fastTruth = 0.1 + i * 0.04;
      slowOut = slow.filter(points(slowTruth, 0.5), i * 33, STANDARD)[0].x;
      fastOut = fast.filter(points(fastTruth, 0.5), i * 33, STANDARD)[0].x;
    }
    // Lag as a fraction of the distance travelled per frame. The whole point of
    // the 1€ filter is that this shrinks as speed rises.
    expect(Math.abs(fastOut - fastTruth) / 0.04).toBeLessThan(
      Math.abs(slowOut - slowTruth) / 0.002,
    );
  });

  it('starts clean after the hand has been out of frame', () => {
    const filter = new PointSetFilter();
    for (let i = 0; i < 20; i++) filter.filter(points(0.2, 0.5), i * 33, STANDARD);
    // Hand gone for a second, then back on the other side of the frame.
    const out = filter.filter(points(0.9, 0.5), 20 * 33 + 1000, STANDARD)[0].x;
    // No easing in from where it used to be: that would draw the skeleton
    // sliding across the frame to catch up with a hand that never moved there.
    expect(out).toBeCloseTo(0.9, 6);
  });

  it('rebuilds its state when the point count changes', () => {
    const filter = new PointSetFilter();
    filter.filter(points(0.2, 0.5), 0, STANDARD);
    const two = filter.filter(
      [
        { x: 0.8, y: 0.1, z: 0 },
        { x: 0.3, y: 0.4, z: 0 },
      ],
      33,
      STANDARD,
    );
    expect(two).toHaveLength(2);
    expect(two[0].x).toBeCloseTo(0.8, 10);
  });
});

function frame(t: number, x: number, world?: number): VisionFrame {
  return {
    t,
    width: 640,
    height: 480,
    pose: null,
    hands: [
      {
        landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 })),
        world:
          world === undefined
            ? undefined
            : Array.from({ length: 21 }, () => ({ x: world, y: 0, z: 0 })),
        handedness: 'Right',
        handednessScore: 0.99,
      },
    ],
  };
}

describe('FrameSmoother', () => {
  it('returns the frame untouched when smoothing is off', () => {
    const smoother = new FrameSmoother();
    const input = frame(0, 0.5);
    expect(smoother.smooth(input, 'off')).toBe(input);
  });

  it('filters world landmarks as well as image ones', () => {
    const smoother = new FrameSmoother();
    smoother.smooth(frame(0, 0.5, 0.1), 'standard');
    const out = smoother.smooth(frame(33, 0.9, 0.5), 'standard');
    expect(out.hands[0].landmarks[0].x).toBeLessThan(0.9);
    expect(out.hands[0].world?.[0].x).toBeLessThan(0.5);
  });

  it('leaves world absent when the tracker did not supply it', () => {
    const smoother = new FrameSmoother();
    smoother.smooth(frame(0, 0.5), 'standard');
    expect(smoother.smooth(frame(33, 0.6), 'standard').hands[0].world).toBeUndefined();
  });

  it('does not mix one hand into the other', () => {
    const smoother = new FrameSmoother();
    const two = (t: number, right: number, left: number): VisionFrame => ({
      t,
      width: 640,
      height: 480,
      pose: null,
      hands: [
        {
          landmarks: [{ x: right, y: 0.5, z: 0 }],
          handedness: 'Right',
          handednessScore: 0.9,
        },
        {
          landmarks: [{ x: left, y: 0.5, z: 0 }],
          handedness: 'Left',
          handednessScore: 0.9,
        },
      ],
    });
    smoother.smooth(two(0, 0.2, 0.8), 'standard');
    const out = smoother.smooth(two(33, 0.2, 0.8), 'standard');
    expect(out.hands[0].landmarks[0].x).toBeCloseTo(0.2, 3);
    expect(out.hands[1].landmarks[0].x).toBeCloseTo(0.8, 3);
  });

  it('forgets a hand that leaves the frame', () => {
    const smoother = new FrameSmoother();
    for (let i = 0; i < 20; i++) smoother.smooth(frame(i * 33, 0.2), 'standard');
    // Empty frame, then the hand reappears elsewhere shortly afterwards.
    smoother.smooth({ t: 660, width: 640, height: 480, pose: null, hands: [] }, 'standard');
    const back = smoother.smooth(frame(693, 0.85), 'standard');
    expect(back.hands[0].landmarks[0].x).toBeCloseTo(0.85, 6);
  });
});
