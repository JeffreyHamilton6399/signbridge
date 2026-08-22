/**
 * MediaPipe reports each frame independently, and the two things it gives you
 * per hand — list position and a Left/Right label — are both unstable. The
 * tracker exists so nothing downstream has to know that.
 */
import { describe, expect, it } from 'vitest';
import { HandTracker } from '@/vision/tracking';
import type { Handedness, HandFrame, Point3, VisionFrame } from '@/vision/types';

function hand(x: number, y: number, handedness: Handedness, score = 0.95): HandFrame {
  // 21 identical points is enough: the tracker only reads the wrist.
  const landmarks: Point3[] = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  return { landmarks, handedness, handednessScore: score };
}

function frame(t: number, hands: HandFrame[]): VisionFrame {
  return { t, width: 640, height: 480, pose: null, hands };
}

describe('HandTracker', () => {
  it('keeps the same id for a hand that moves normally', () => {
    const tracker = new HandTracker();
    let id: number | undefined;
    for (let i = 0; i < 20; i++) {
      const out = tracker.track(frame(i * 33, [hand(0.3 + i * 0.01, 0.5, 'Right')]));
      if (i === 0) id = out.hands[0].id;
      expect(out.hands[0].id).toBe(id);
    }
  });

  it('holds the handedness verdict when one frame disagrees', () => {
    const tracker = new HandTracker();
    for (let i = 0; i < 15; i++) tracker.track(frame(i * 33, [hand(0.3, 0.5, 'Right')]));
    // One frame of nonsense — the label flips on rotation and near the edge.
    const wobble = tracker.track(frame(15 * 33, [hand(0.3, 0.5, 'Left')]));
    expect(wobble.hands[0].handedness).toBe('Right');
  });

  it('does eventually accept a genuinely different hand', () => {
    const tracker = new HandTracker();
    for (let i = 0; i < 15; i++) tracker.track(frame(i * 33, [hand(0.3, 0.5, 'Right')]));
    let out = frame(0, []);
    for (let i = 15; i < 60; i++) out = tracker.track(frame(i * 33, [hand(0.3, 0.5, 'Left')]));
    expect(out.hands[0].handedness).toBe('Left');
  });

  it('reports low confidence while a label is still contested', () => {
    const tracker = new HandTracker();
    let out = frame(0, []);
    for (let i = 0; i < 30; i++) {
      // Alternating labels: the verdict should sit near the middle and say so,
      // rather than claiming 95% for whichever frame happened to be last.
      out = tracker.track(frame(i * 33, [hand(0.3, 0.5, i % 2 === 0 ? 'Right' : 'Left')]));
    }
    expect(out.hands[0].handednessScore).toBeLessThan(0.35);
  });

  it('does not swap identities when two hands cross', () => {
    const tracker = new HandTracker();
    const first = tracker.track(frame(0, [hand(0.2, 0.5, 'Right'), hand(0.8, 0.5, 'Left')]));
    const rightId = first.hands[0].id;
    const leftId = first.hands[1].id;
    expect(rightId).not.toBe(leftId);

    // They approach, then MediaPipe returns them in the opposite list order.
    let out = first;
    for (let i = 1; i <= 10; i++) {
      const a = 0.2 + i * 0.02;
      const b = 0.8 - i * 0.02;
      out = tracker.track(frame(i * 33, [hand(b, 0.5, 'Left'), hand(a, 0.5, 'Right')]));
    }
    // Identity follows position, not list order: the hand that started at 0.2
    // is the one now on the left of the list at ~0.4.
    const byId = new Map(out.hands.map((h) => [h.id, h.landmarks[0].x]));
    expect(byId.get(rightId)).toBeCloseTo(0.4, 2);
    expect(byId.get(leftId)).toBeCloseTo(0.6, 2);
  });

  it('issues a new id to a hand that reappears after a long absence', () => {
    const tracker = new HandTracker();
    const first = tracker.track(frame(0, [hand(0.3, 0.5, 'Right')]));
    for (let i = 1; i < 5; i++) tracker.track(frame(i * 200, []));
    const again = tracker.track(frame(2000, [hand(0.3, 0.5, 'Right')]));
    expect(again.hands[0].id).not.toBe(first.hands[0].id);
  });

  it('issues a new id rather than teleporting a track across the frame', () => {
    const tracker = new HandTracker();
    const first = tracker.track(frame(0, [hand(0.1, 0.5, 'Right')]));
    const jumped = tracker.track(frame(33, [hand(0.9, 0.5, 'Right')]));
    expect(jumped.hands[0].id).not.toBe(first.hands[0].id);
  });

  it('leaves an empty frame alone', () => {
    const tracker = new HandTracker();
    const empty = frame(0, []);
    expect(tracker.track(empty)).toBe(empty);
  });
});
