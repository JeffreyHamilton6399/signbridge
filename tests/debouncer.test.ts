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

/**
 * Soft voting.
 *
 * The old behaviour threw away everything except each frame's winner, which is
 * exactly the wrong thing to do in the fist cluster, where the margin between
 * the right letter and the wrong one is a few hundredths.
 */
describe('DwellCommitter with distributions', () => {
  const config = {
    confidenceThreshold: 0.5,
    dwellMs: 200,
    autoSpaceMs: 900,
    smoothingWindow: 5,
  };

  /** Feed the same distribution for `frames` frames at 30fps. */
  function hold(
    committer: DwellCommitter,
    distribution: Record<string, number>,
    frames: number,
    startT = 0,
  ) {
    let event: DwellEvent = { type: 'idle' };
    for (let i = 0; i < frames; i++) {
      const top = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0];
      event = committer.feed({
        label: top[0],
        confidence: top[1],
        distribution,
        handY: 0.5,
        t: startT + i * 33,
      });
    }
    return event;
  }

  it('commits the letter with the most evidence, not the most wins', () => {
    const committer = new DwellCommitter(config);
    // Every frame of the first three nominates A by a hair with T close behind,
    // then the hand settles and the frames become decisive. Majority voting
    // would have banked three votes for A and none for T.
    const sequence: Record<string, number>[] = [
      { A: 0.36, T: 0.34 },
      { A: 0.36, T: 0.34 },
      { A: 0.36, T: 0.34 },
      ...Array.from({ length: 12 }, () => ({ T: 0.9, A: 0.05 })),
    ];
    const commits: DwellEvent[] = [];
    sequence.forEach((distribution, i) => {
      const top = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0];
      const event = committer.feed({
        label: top[0],
        confidence: top[1],
        distribution,
        handY: 0.5,
        t: i * 33,
      });
      if (event.type === 'commit') commits.push(event);
    });
    expect(commits.length).toBeGreaterThan(0);
    const first = commits[0];
    if (first.type === 'commit') expect(first.label).toBe('T');
  });

  it('reports the smoothed confidence, not the latest frame', () => {
    const committer = new DwellCommitter(config);
    const event = hold(committer, { B: 0.8, D: 0.1 }, 3);
    expect(event.type).toBe('tracking');
    // Three frames of 0.8 across a five-frame window: two frames of no evidence
    // have not happened yet, so the mean is over what has been seen.
    if (event.type === 'tracking') expect(event.confidence).toBeCloseTo(0.8, 2);
  });

  it('will not commit on a hand that is only tracked intermittently', () => {
    const committer = new DwellCommitter(config);
    let event: DwellEvent = { type: 'idle' };
    // Two good frames in every five: a mean of at most 0.4, under the 0.5 floor.
    for (let i = 0; i < 25; i++) {
      event =
        i % 5 < 2
          ? committer.feed({
              label: 'C',
              confidence: 0.95,
              distribution: { C: 0.95 },
              handY: 0.5,
              t: i * 33,
            })
          : committer.feed({ label: null, confidence: 0, handY: 0.5, t: i * 33 });
      expect(event.type).not.toBe('commit');
    }
  });

  it('still votes on hard labels when no distribution is supplied', () => {
    const committer = new DwellCommitter(config);
    const commits: DwellEvent[] = [];
    for (let i = 0; i < 12; i++) {
      const event = committer.feed({ label: 'K', confidence: 0.9, handY: 0.5, t: i * 33 });
      if (event.type === 'commit') commits.push(event);
    }
    expect(commits.length).toBeGreaterThan(0);
    const first = commits[0];
    if (first.type === 'commit') expect(first.label).toBe('K');
  });
});
