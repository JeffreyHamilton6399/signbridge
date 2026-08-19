/**
 * J and Z - the two ASL letters that are movements, not poses.
 *
 * Both are recognised from a short trajectory of one fingertip rather than a
 * single frame, so they get their own tiny temporal head instead of being
 * forced into the static classifier where they would only ever look like I and
 * D respectively.
 *
 * Coordinates are raw image coordinates (x right, y DOWN, origin top-left) taken
 * before mirroring, so the templates describe what the camera sees, not what the
 * signer feels. The mirror toggle does not affect recognition.
 */
import type { Point3 } from '@/vision/types';
import { HAND_LANDMARK } from '@/vision/types';

export interface TrajectoryPoint {
  x: number;
  y: number;
  t: number;
}

export interface MotionMatch {
  letter: 'J' | 'Z';
  confidence: number;
}

/** Frames of history the motion head looks at. ~400ms at 30fps. */
export const MOTION_WINDOW = 12;
/** Minimum path length, in hand spans, before we will call anything a movement. */
const MIN_PATH = 0.9;
/** Number of points every trajectory is resampled to before matching. */
const RESAMPLE = 9;

type Dir = readonly [number, number];

function unit(v: Dir): Dir {
  const m = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / m, v[1] / m];
}

/**
 * J: from an I handshape the pinky drops, hooks toward the signer's left (the
 * viewer's right in an unmirrored frame), and rises.
 */
const J_TEMPLATE: Dir[] = (
  [
    [0.1, 1], [0, 1], [0.2, 1], [0.6, 0.8], [0.95, 0.3], [0.8, -0.5], [0.3, -0.9], [0.1, -1],
  ] as Dir[]
).map(unit);

/**
 * Z: the index finger draws the letter - across, diagonally back, across again.
 */
const Z_TEMPLATE: Dir[] = (
  [
    [1, 0], [1, 0], [-0.75, 0.66], [-0.75, 0.66], [-0.7, 0.7], [1, 0], [1, 0], [1, 0],
  ] as Dir[]
).map(unit);

function resample(points: TrajectoryPoint[], n: number): TrajectoryPoint[] {
  if (points.length <= 1) return points.slice();
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(
      cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return [points[0], points[points.length - 1]];

  const out: TrajectoryPoint[] = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < target) i++;
    const segment = cumulative[i] - cumulative[i - 1] || 1;
    const f = (target - cumulative[i - 1]) / segment;
    out.push({
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * f,
      t: points[i - 1].t + (points[i].t - points[i - 1].t) * f,
    });
  }
  return out;
}

function directions(points: TrajectoryPoint[]): Dir[] {
  const out: Dir[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push(unit([points[i].x - points[i - 1].x, points[i].y - points[i - 1].y]));
  }
  return out;
}

/** Mean cosine similarity between two equal-length direction sequences, 0..1. */
function matchScore(dirs: Dir[], template: Dir[]): number {
  const n = Math.min(dirs.length, template.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += dirs[i][0] * template[i][0] + dirs[i][1] * template[i][1];
  }
  return Math.max(0, sum / n);
}

export function pathLength(points: TrajectoryPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return d;
}

/**
 * Rolling trajectory buffer for one fingertip. The caller pushes a point per
 * frame and asks whether the recent path looks like J or Z.
 */
export class MotionLetterDetector {
  private pinky: TrajectoryPoint[] = [];
  private index: TrajectoryPoint[] = [];
  private lastFireAt = 0;

  /** Push one frame. `span` is the hand span in the same units as x/y. */
  push(landmarks: Point3[], span: number, t: number): void {
    const s = span || 1;
    const pinkyTip = landmarks[HAND_LANDMARK.PINKY_TIP];
    const indexTip = landmarks[HAND_LANDMARK.INDEX_TIP];
    this.pinky.push({ x: pinkyTip.x / s, y: pinkyTip.y / s, t });
    this.index.push({ x: indexTip.x / s, y: indexTip.y / s, t });
    if (this.pinky.length > MOTION_WINDOW) this.pinky.shift();
    if (this.index.length > MOTION_WINDOW) this.index.shift();
  }

  reset(): void {
    this.pinky = [];
    this.index = [];
  }

  /**
   * @param staticDistribution probabilities from the static classifier - the
   *        handshape gates the motion, so a J only fires from an I shape.
   */
  detect(staticDistribution: Record<string, number>, now: number): MotionMatch | null {
    // One motion letter per 700ms; without this a single J fires repeatedly as
    // the window slides.
    if (now - this.lastFireAt < 700) return null;
    if (this.pinky.length < MOTION_WINDOW) return null;

    const jShape = staticDistribution['I'] ?? 0;
    const zShape = Math.max(staticDistribution['D'] ?? 0, staticDistribution['X'] ?? 0);

    const jPath = pathLength(this.pinky);
    const zPath = pathLength(this.index);

    let best: MotionMatch | null = null;

    if (jShape > 0.25 && jPath > MIN_PATH) {
      const score = matchScore(directions(resample(this.pinky, RESAMPLE)), J_TEMPLATE);
      const confidence = score * Math.min(1, jShape * 2);
      if (confidence > 0.55) best = { letter: 'J', confidence };
    }

    if (zShape > 0.25 && zPath > MIN_PATH * 1.4) {
      const score = matchScore(directions(resample(this.index, RESAMPLE)), Z_TEMPLATE);
      const confidence = score * Math.min(1, zShape * 2);
      if (confidence > 0.55 && (!best || confidence > best.confidence)) {
        best = { letter: 'Z', confidence };
      }
    }

    if (best) {
      this.lastFireAt = now;
      this.reset();
    }
    return best;
  }
}
