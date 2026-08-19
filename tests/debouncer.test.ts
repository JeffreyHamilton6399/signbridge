/**
 * The dwell committer decides what actually reaches the transcript, so its
 * behaviour under flicker, frame drops and repeated letters is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { DwellCommitter } from '@/modes/fingerspell/debouncer';
import type { DwellEvent } from '@/modes/fingerspell/debouncer';

const CONFIG = {
  confidenceThreshold: 0.6,
  dwellMs: 300,
  autoSpaceMs: 600,
  smoothingWindow: 3,
  restY: 0.82,
  repeatBlockMs: 100,
};

function feedSteady(
  committer: DwellCommitter,
  label: string,
  frames: number,
  startT = 0,
  stepMs = 33,
  confidence = 0.9,
): DwellEvent[] {
  const events: DwellEvent[] = [];
  for (let i = 0; i < frames; i++) {
    events.push(committer.feed({ label, confidence, handY: 0.5, t: startT + i * stepMs }));
  }
  return events;
}

describe('DwellCommitter', () => {
  it('does not commit before the dwell time elapses', () => {
    const committer = new DwellCommitter(CONFIG);
    const events = feedSteady(committer, 'A', 5); // 5 * 33ms = 132ms < 300ms
    expect(events.some((e) => e.type === 'commit')).toBe(false);
    expect(events.at(-1)?.type).toBe('tracking');
  });

  it('commits once the letter has been held long enough', () => {
    const committer = new DwellCommitter(CONFIG);
    const events = feedSteady(committer, 'A', 20);
    const commits = events.filter((e) => e.type === 'commit');
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits[0]).toMatchObject({ type: 'commit', label: 'A' });
  });

  it('reports dwell progress from 0 to 1', () => {
    const committer = new DwellCommitter(CONFIG);
    const events = feedSteady(committer, 'B', 8);
    const tracking = events.filter((e) => e.type === 'tracking');
    expect(tracking[0].progress).toBeLessThan(0.3);
    expect(tracking.at(-1)!.progress).toBeGreaterThan(0.6);
  });

  it('ignores frames below the confidence threshold', () => {
    const committer = new DwellCommitter(CONFIG);
    const events: DwellEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(committer.feed({ label: 'C', confidence: 0.4, handY: 0.5, t: i * 33 }));
    }
    expect(events.every((e) => e.type === 'idle')).toBe(true);
  });

  it('survives single-frame flicker to a neighbouring letter', () => {
    const committer = new DwellCommitter(CONFIG);
    let committed: string | null = null;
    for (let i = 0; i < 20; i++) {
      // One frame in six reads as S instead of A - the classic M/N/S/T flicker.
      const label = i % 6 === 3 ? 'S' : 'A';
      const event = committer.feed({ label, confidence: 0.9, handY: 0.5, t: i * 33 });
      if (event.type === 'commit') committed ??= event.label;
    }
    expect(committed).toBe('A');
  });

  it('does not commit the same letter twice from one hold', () => {
    const committer = new DwellCommitter({ ...CONFIG, repeatBlockMs: 5000 });
    const events = feedSteady(committer, 'A', 60);
    expect(events.filter((e) => e.type === 'commit')).toHaveLength(1);
  });

  it('commits two different letters back to back', () => {
    const committer = new DwellCommitter(CONFIG);
    const first = feedSteady(committer, 'A', 15, 0);
    const second = feedSteady(committer, 'B', 15, 15 * 33);
    expect(first.filter((e) => e.type === 'commit')).toHaveLength(1);
    expect(second.filter((e) => e.type === 'commit')).toHaveLength(1);
  });

  it('inserts a space when the hand leaves the frame', () => {
    const committer = new DwellCommitter(CONFIG);
    feedSteady(committer, 'A', 15, 0);
    let space = false;
    for (let i = 0; i < 40; i++) {
      // No handY at all: the hand is gone.
      const event = committer.feed({ label: null, confidence: 0, t: 15 * 33 + i * 33 });
      if (event.type === 'space') space = true;
    }
    expect(space).toBe(true);
  });

  it('inserts a space when the hand drops to rest', () => {
    const committer = new DwellCommitter(CONFIG);
    feedSteady(committer, 'A', 15, 0);
    let space = false;
    for (let i = 0; i < 40; i++) {
      const event = committer.feed({
        label: null,
        confidence: 0,
        handY: 0.95,
        t: 15 * 33 + i * 33,
      });
      if (event.type === 'space') space = true;
    }
    expect(space).toBe(true);
  });

  it('does not emit a second space while the hand stays away', () => {
    const committer = new DwellCommitter(CONFIG);
    feedSteady(committer, 'A', 15, 0);
    let spaces = 0;
    for (let i = 0; i < 120; i++) {
      if (committer.feed({ label: null, confidence: 0, t: 15 * 33 + i * 33 }).type === 'space') {
        spaces++;
      }
    }
    expect(spaces).toBe(1);
  });

  it('accounts for dropped frames by timestamp, not frame count', () => {
    const committer = new DwellCommitter(CONFIG);
    // Only three frames, but spread across 400ms - long enough to commit.
    committer.feed({ label: 'A', confidence: 0.9, handY: 0.5, t: 0 });
    committer.feed({ label: 'A', confidence: 0.9, handY: 0.5, t: 200 });
    const third = committer.feed({ label: 'A', confidence: 0.9, handY: 0.5, t: 400 });
    expect(third.type).toBe('commit');
  });

  it('applies updated settings without losing its place', () => {
    const committer = new DwellCommitter(CONFIG);
    committer.update({ dwellMs: 1000 });
    expect(committer.settings.dwellMs).toBe(1000);
    expect(committer.settings.confidenceThreshold).toBe(CONFIG.confidenceThreshold);
  });
});
