/**
 * The scan-quality check exists to make the app decline to guess, so the thing
 * that most needs pinning is that it only ever withholds. If a future change
 * lets it raise a confidence or force a commit, these should fail.
 */
import { describe, expect, it } from 'vitest';
import { assessScan, ScanQualityTracker } from '@/features/scanQuality';
import type { HandFrame, Point3, VisionFrame } from '@/vision/types';

const FRAME: VisionFrame = { t: 0, width: 640, height: 480, pose: null, hands: [] };

/**
 * A hand centred at (cx, cy) whose wrist-to-middle-knuckle span is `span` as a
 * fraction of frame height.
 */
function hand(span: number, cx = 0.5, cy = 0.5, id = 1): HandFrame {
  const aspect = FRAME.width / FRAME.height;
  const landmarks: Point3[] = Array.from({ length: 21 }, (_, i) => ({
    // Wrist at the bottom, middle MCP one span above it, everything else near.
    x: cx + (i === 0 ? 0 : 0.01) / aspect,
    y: cy + (i === 0 ? span / 2 : -span / 2),
    z: 0,
  }));
  return { id, landmarks, handedness: 'Right', handednessScore: 0.95 };
}

const ok = (h: HandFrame | undefined, speed = 0, palmFacing = 1) =>
  assessScan({ hand: h, frame: FRAME, speed, palmFacing });

describe('assessScan', () => {
  it('says so when there is no hand at all', () => {
    const scan = ok(undefined);
    expect(scan.problem).toBe('no-hand');
    expect(scan.unusable).toBe(true);
  });

  it('passes a well-framed, still, palm-on hand', () => {
    const scan = ok(hand(0.16));
    expect(scan.problem).toBeNull();
    expect(scan.unusable).toBe(false);
    expect(scan.score).toBe(1);
  });

  it('refuses a hand that is mostly outside the frame', () => {
    const scan = ok(hand(0.16, 1.06, 0.5));
    expect(scan.problem).toBe('out-of-frame');
    expect(scan.unusable).toBe(true);
    expect(scan.advice).not.toBe('');
  });

  it('refuses a hand too far away to resolve', () => {
    const scan = ok(hand(0.03));
    expect(scan.problem).toBe('too-small');
    expect(scan.unusable).toBe(true);
  });

  it('refuses a frame the hand is smearing through', () => {
    const scan = ok(hand(0.16), 20);
    expect(scan.problem).toBe('too-fast');
    expect(scan.unusable).toBe(true);
  });

  it('mentions an edge-on palm without refusing it', () => {
    // Some letters are legitimately signed at an angle, so this lowers the
    // score and offers advice; it never blocks.
    const scan = ok(hand(0.16), 0, 0.02);
    expect(scan.problem).toBe('edge-on');
    expect(scan.unusable).toBe(false);
    expect(scan.score).toBeLessThan(0.6);
  });

  it('stays quiet about a view that is merely not perfect', () => {
    const scan = ok(hand(0.16), 0, 0.9);
    expect(scan.problem).toBeNull();
    expect(scan.advice).toBe('');
  });

  it('always offers advice with a blocking problem', () => {
    for (const scan of [ok(undefined), ok(hand(0.03)), ok(hand(0.16), 20)]) {
      expect(scan.unusable).toBe(true);
      expect(scan.advice.length).toBeGreaterThan(0);
    }
  });
});

describe('ScanQualityTracker', () => {
  it('reports no speed for the first frame it sees', () => {
    expect(new ScanQualityTracker().update(hand(0.16), 0)).toBe(0);
  });

  it('reports no speed across a gap in tracking', () => {
    const tracker = new ScanQualityTracker();
    tracker.update(hand(0.16, 0.2), 0);
    // Half a second later: there is no velocity here, only two positions.
    expect(tracker.update(hand(0.16, 0.9), 600)).toBe(0);
  });

  it('reports no speed when the hand is a different hand', () => {
    const tracker = new ScanQualityTracker();
    tracker.update(hand(0.16, 0.2, 0.5, 1), 0);
    expect(tracker.update(hand(0.16, 0.9, 0.5, 2), 33)).toBe(0);
  });

  it('rises with real movement and settles back when it stops', () => {
    const tracker = new ScanQualityTracker();
    let moving = 0;
    for (let i = 0; i < 10; i++) moving = tracker.update(hand(0.16, 0.2 + i * 0.03), i * 33);
    expect(moving).toBeGreaterThan(2);

    let still = moving;
    for (let i = 10; i < 25; i++) still = tracker.update(hand(0.16, 0.47), i * 33);
    expect(still).toBeLessThan(moving * 0.2);
  });
});
