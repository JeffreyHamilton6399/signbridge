/**
 * Frame-budget benchmark.
 *
 * The brief's budget is 150 ms end to end, gesture to caption. CI cannot
 * measure that honestly — there is no camera, and MediaPipe landmark extraction
 * (8–20 ms, and the dominant term) does not run here. What CI *can* guard is the
 * part that runs on the main thread every frame and would silently rot:
 * normalization, geometry, 24-template scoring, prototype blending, and the
 * dwell committer.
 *
 * That work has a hard budget of 3 ms at p95. At 30 fps the whole frame is
 * 33 ms and the video element needs most of it; anything above 3 ms here shows
 * up as caption jank. The real end-to-end number is measured live in the debug
 * panel, where it belongs.
 */
import { describe, expect, it } from 'vitest';
import { FingerspellClassifier } from '@/modes/fingerspell/classifier';
import { DwellCommitter } from '@/modes/fingerspell/debouncer';
import { buildPrototypes } from '@/modes/fingerspell/calibration';
import type { CalibrationSample } from '@/modes/fingerspell/calibration';
import { STATIC_LETTERS } from '@/modes/fingerspell/letterTemplates';
import { resampleWindow, PER_FRAME_DIM } from '@/features/window';
import type { HandFrame, Point3 } from '@/vision/types';

const MAIN_THREAD_BUDGET_MS = 3;
const ITERATIONS = 600;

function syntheticHand(seed: number): HandFrame {
  const template: [number, number][] = [
    [0, 0],
    [-0.3, -0.2], [-0.5, -0.45], [-0.62, -0.65], [-0.7, -0.82],
    [-0.25, -0.9], [-0.28, -1.35], [-0.3, -1.6], [-0.32, -1.85],
    [0, -1], [0, -1.5], [0, -1.78], [0, -2.05],
    [0.25, -0.95], [0.3, -1.4], [0.32, -1.66], [0.34, -1.9],
    [0.48, -0.85], [0.56, -1.2], [0.6, -1.42], [0.63, -1.62],
  ];
  const wobble = Math.sin(seed) * 0.02;
  const landmarks: Point3[] = template.map(([x, y]) => ({
    x: 0.5 + (x + wobble) * 0.1,
    y: 0.6 + (y + wobble) * 0.1,
    z: wobble * 0.1,
  }));
  return { landmarks, handedness: 'Right', handednessScore: 0.98 };
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

describe('per-frame budget', () => {
  it('classifies and commits well inside the main-thread budget', () => {
    // Worst realistic case: a fully calibrated user, so the prototype blend runs.
    const samples: CalibrationSample[] = STATIC_LETTERS.flatMap((label, i) =>
      Array.from({ length: 8 }, (_, j) => ({
        label,
        features: Float32Array.from({ length: 63 }, (_, k) => Math.sin(i + j * 0.1 + k * 0.01)),
        t: 0,
      })),
    );

    const classifier = new FingerspellClassifier();
    classifier.setPrototypes(buildPrototypes(samples));
    const committer = new DwellCommitter();

    // Warm up so JIT compilation is not counted.
    for (let i = 0; i < 100; i++) classifier.predict(syntheticHand(i), 16 / 9);

    const timings: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const hand = syntheticHand(i);
      const start = performance.now();
      const prediction = classifier.predict(hand, 16 / 9);
      committer.feed({
        label: prediction.label,
        confidence: prediction.confidence,
        handY: 0.5,
        t: i * 33,
      });
      timings.push(performance.now() - start);
    }

    const p95 = percentile(timings, 0.95);
    const median = percentile(timings, 0.5);
    // Reported so a regression is visible in CI output even before it fails.
    console.info(
      `per-frame main-thread cost: median ${median.toFixed(3)}ms, p95 ${p95.toFixed(3)}ms ` +
        `(budget ${MAIN_THREAD_BUDGET_MS}ms)`,
    );
    expect(p95).toBeLessThan(MAIN_THREAD_BUDGET_MS);
  });

  it('resamples a sign window fast enough to run at the end of every sign', () => {
    const frames = Array.from({ length: 90 }, (_, i) =>
      Float32Array.from({ length: PER_FRAME_DIM }, () => i / 89),
    );
    for (let i = 0; i < 20; i++) resampleWindow(frames);

    const timings: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      resampleWindow(frames);
      timings.push(performance.now() - start);
    }
    expect(percentile(timings, 0.95)).toBeLessThan(MAIN_THREAD_BUDGET_MS);
  });
});
