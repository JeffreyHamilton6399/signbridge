/**
 * J and Z — the two letters that are movements.
 *
 * Two of the twenty-six, with their own detection path, and until now no test
 * of any kind. The static alphabet at least had the fist cluster checked; this
 * had nothing, which means "does J work" had no answer other than trying it.
 *
 * The trajectories here are built by walking the same direction templates the
 * detector matches against, so a passing test means the machinery around the
 * template works — resampling, the path-length floor, the handshape gate, the
 * refractory period. It does not mean the templates describe how a real person
 * draws a J. Nothing here can tell you that.
 */
import { describe, expect, it } from 'vitest';
import { MOTION_WINDOW, MotionLetterDetector, pathLength } from '@/modes/fingerspell/motion';
import { HAND_LANDMARK } from '@/vision/types';
import type { Point3 } from '@/vision/types';

/**
 * The shapes the detector is looking for, in image coordinates: x right, y
 * DOWN. Restated here rather than imported, so a change to the templates has to
 * be a deliberate change to the spec as well.
 */
const J_PATH: [number, number][] = [
  [0.1, 1], [0, 1], [0.2, 1], [0.6, 0.8], [0.95, 0.3], [0.8, -0.5], [0.3, -0.9], [0.1, -1],
];
const Z_PATH: [number, number][] = [
  [1, 0], [1, 0], [-0.75, 0.66], [-0.75, 0.66], [-0.7, 0.7], [1, 0], [1, 0], [1, 0],
];

function unit([x, y]: [number, number]): [number, number] {
  const m = Math.hypot(x, y) || 1;
  return [x / m, y / m];
}

/** Walk a direction template into a polyline, then sample it evenly. */
function trajectory(template: [number, number][], steps: number, scale: number) {
  const corners = [{ x: 0.5, y: 0.5 }];
  for (const d of template) {
    const [dx, dy] = unit(d);
    const last = corners[corners.length - 1];
    corners.push({ x: last.x + dx * scale, y: last.y + dy * scale });
  }

  const cumulative = [0];
  for (let i = 1; i < corners.length; i++) {
    cumulative.push(
      cumulative[i - 1] + Math.hypot(corners[i].x - corners[i - 1].x, corners[i].y - corners[i - 1].y),
    );
  }
  const total = cumulative[cumulative.length - 1];

  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < steps; k++) {
    const target = (total * k) / (steps - 1);
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < target) i++;
    const seg = cumulative[i] - cumulative[i - 1] || 1;
    const f = (target - cumulative[i - 1]) / seg;
    out.push({
      x: corners[i - 1].x + (corners[i].x - corners[i - 1].x) * f,
      y: corners[i - 1].y + (corners[i].y - corners[i - 1].y) * f,
    });
  }
  return out;
}

/** Landmarks where only the tip that matters is placed. */
function handWithTip(which: 'pinky' | 'index', at: { x: number; y: number }): Point3[] {
  const landmarks: Point3[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const tip = which === 'pinky' ? HAND_LANDMARK.PINKY_TIP : HAND_LANDMARK.INDEX_TIP;
  landmarks[tip] = { ...at, z: 0 };
  return landmarks;
}

const AS_I = { I: 0.9, D: 0.02, X: 0.02 };
const AS_D = { D: 0.9, I: 0.02, X: 0.02 };
const AS_B = { B: 0.95, I: 0.01, D: 0.01 };

/**
 * Feed a whole trajectory and return whatever the last frame detected.
 *
 * Timestamps start at zero deliberately. They used to have to start at 5000 for
 * any of this to fire, because the detector initialised 'last fired' to 0 and
 * then refused to fire for 700ms after it — a fresh detector claiming it had
 * just produced a letter.
 */
function run(
  detector: MotionLetterDetector,
  which: 'pinky' | 'index',
  points: { x: number; y: number }[],
  distribution: Record<string, number>,
  startT = 0,
) {
  let last = null as ReturnType<MotionLetterDetector['detect']>;
  points.forEach((p, i) => {
    const t = startT + i * 33;
    detector.push(handWithTip(which, p), 1, t);
    last = detector.detect(distribution, t);
  });
  return last;
}

describe('motion letters', () => {
  it('recognises a J drawn with the pinky from an I hand', () => {
    const hit = run(new MotionLetterDetector(), 'pinky', trajectory(J_PATH, MOTION_WINDOW, 0.2), AS_I);
    expect(hit?.letter).toBe('J');
    expect(hit!.confidence).toBeGreaterThan(0.55);
  });

  it('recognises a Z drawn with the index finger from a D hand', () => {
    const hit = run(new MotionLetterDetector(), 'index', trajectory(Z_PATH, MOTION_WINDOW, 0.3), AS_D);
    expect(hit?.letter).toBe('Z');
    expect(hit!.confidence).toBeGreaterThan(0.55);
  });

  it('will not fire from the wrong handshape', () => {
    // The movement is the same; the hand is a B. Movement alone is not a letter,
    // and without this gate every wave of the hand is a J.
    expect(run(new MotionLetterDetector(), 'pinky', trajectory(J_PATH, MOTION_WINDOW, 0.2), AS_B)).toBeNull();
  });

  it('will not fire on a still hand', () => {
    const still = Array.from({ length: MOTION_WINDOW }, () => ({ x: 0.5, y: 0.5 }));
    expect(run(new MotionLetterDetector(), 'pinky', still, AS_I)).toBeNull();
  });

  it('will not fire on a movement that is not the letter', () => {
    // A straight sweep from an I hand. It clears the path floor and fails the
    // shape, which is the only thing standing between "moved" and "wrote a J".
    const straight = Array.from({ length: MOTION_WINDOW }, (_, i) => ({ x: 0.5 + i * 0.15, y: 0.5 }));
    expect(run(new MotionLetterDetector(), 'pinky', straight, AS_I)).toBeNull();
  });

  it('will not fire before it has a full window', () => {
    const detector = new MotionLetterDetector();
    const points = trajectory(J_PATH, MOTION_WINDOW, 0.2);
    const short = run(detector, 'pinky', points.slice(0, MOTION_WINDOW - 1), AS_I);
    expect(short).toBeNull();
  });

  it('fires once per movement, not once per frame as the window slides', () => {
    // The window holds the last twelve frames, so the frame after a J still
    // contains eleven twelfths of a J. Without a refractory period one movement
    // writes a row of them.
    const detector = new MotionLetterDetector();
    const points = trajectory(J_PATH, MOTION_WINDOW, 0.2);
    const frames = [...points, ...points.slice(0, 8)];
    let fired = 0;
    frames.forEach((p, i) => {
      const t = i * 33;
      detector.push(handWithTip('pinky', p), 1, t);
      if (detector.detect(AS_I, t)) fired++;
    });
    // 660ms of frames, inside the 700ms refractory.
    expect(frames.length * 33).toBeLessThan(700);
    expect(fired).toBe(1);
  });

  it('can fire again once the refractory period has passed', () => {
    // A blanket 'only ever once' would make JJ unspellable.
    const detector = new MotionLetterDetector();
    const points = trajectory(J_PATH, MOTION_WINDOW, 0.2);
    let fired = 0;
    for (let repeat = 0; repeat < 3; repeat++) {
      points.forEach((p, i) => {
        const t = repeat * 800 + i * 33;
        detector.push(handWithTip('pinky', p), 1, t);
        if (detector.detect(AS_I, t)) fired++;
      });
    }
    expect(fired).toBe(3);
  });

  it('measures path length in hand spans, so distance from the camera drops out', () => {
    const near = trajectory(J_PATH, MOTION_WINDOW, 0.2);
    const far = near.map((p) => ({ x: p.x / 2, y: p.y / 2 }));
    // Same gesture, half the pixels, half the hand span.
    const a = new MotionLetterDetector();
    const b = new MotionLetterDetector();
    near.forEach((p, i) => a.push(handWithTip('pinky', p), 1, i * 33));
    far.forEach((p, i) => b.push(handWithTip('pinky', p), 0.5, i * 33));
    expect(a.detect(AS_I, 400)?.letter).toBe('J');
    expect(b.detect(AS_I, 400)?.letter).toBe('J');
  });

  it('exposes path length for the caller to reason about', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ x: 0, y: 0, t: 0 }, { x: 3, y: 4, t: 33 }])).toBeCloseTo(5, 6);
  });
});

/**
 * Not committing the letter you are in the middle of drawing.
 *
 * J is an I that moves and Z is a D that moves. While either is being drawn,
 * the static classifier reports that letter — correctly and with real
 * confidence, because that genuinely is the handshape — and the two paths race:
 * detection needs a full motion window, the static commit needs its dwell.
 *
 * Whoever wins is an accident of configuration, and it became a likelier
 * accident when dwell started scaling with confidence, because an unambiguous I
 * now commits in about 300ms and the motion window is about 400ms.
 */
describe('motion in progress', () => {
  const detector = () => new MotionLetterDetector();

  it('is false for a hand that is holding still', () => {
    // A still I is an I. Suppressing it would make the letter unspellable,
    // which is a worse bug than the one this exists to fix.
    const d = detector();
    for (let i = 0; i < MOTION_WINDOW; i++) d.push(handWithTip('pinky', { x: 0.5, y: 0.5 }), 1, i * 33);
    expect(d.inProgress(AS_I)).toBe(false);
  });

  it('is true well before the movement is complete', () => {
    // The whole point is to get there first. Half a J is enough.
    const d = detector();
    const points = trajectory(J_PATH, MOTION_WINDOW, 0.2);
    points.slice(0, Math.ceil(MOTION_WINDOW / 2)).forEach((p, i) => {
      d.push(handWithTip('pinky', p), 1, i * 33);
    });
    expect(d.inProgress(AS_I)).toBe(true);
  });

  it('is false when the handshape is not a motion letter', () => {
    // Otherwise every hand that moves stops being able to commit anything.
    const d = detector();
    trajectory(J_PATH, MOTION_WINDOW, 0.2).forEach((p, i) => {
      d.push(handWithTip('pinky', p), 1, i * 33);
    });
    expect(d.inProgress(AS_B)).toBe(false);
  });

  it('sees a Z being drawn from a D hand', () => {
    const d = detector();
    trajectory(Z_PATH, MOTION_WINDOW, 0.3).forEach((p, i) => {
      d.push(handWithTip('index', p), 1, i * 33);
    });
    expect(d.inProgress(AS_D)).toBe(true);
  });

  it('goes quiet again after the letter fires', () => {
    // detect() resets the buffer, so the next frame starts from nothing and the
    // static head is free to commit again immediately.
    const d = detector();
    const points = trajectory(J_PATH, MOTION_WINDOW, 0.2);
    points.forEach((p, i) => d.push(handWithTip('pinky', p), 1, i * 33));
    expect(d.detect(AS_I, MOTION_WINDOW * 33)?.letter).toBe('J');
    expect(d.inProgress(AS_I)).toBe(false);
  });
});
