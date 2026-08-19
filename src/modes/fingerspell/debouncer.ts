/**
 * Dwell-time commit and auto-space.
 *
 * This is the biggest single quality lever in fingerspelling mode. The model
 * flickers between neighbouring letters frame to frame; requiring a label to
 * hold steady above threshold for a configurable dwell before it commits turns
 * that flicker into a stable stream of letters. Users tune it: fast signers want
 * 350ms, beginners want 900ms.
 *
 * Pure logic, no DOM and no timers of its own - the caller drives it with frame
 * timestamps, which makes it directly testable and keeps it honest under frame
 * drops.
 */

export interface DwellConfig {
  /** Probability a label must exceed to accumulate dwell time. */
  confidenceThreshold: number;
  /** Milliseconds a label must hold before it commits. */
  dwellMs: number;
  /** Milliseconds without a hand (or with the hand at rest) before a space. */
  autoSpaceMs: number;
  /** Frames of majority voting applied before dwell accounting. */
  smoothingWindow: number;
  /** Below this normalized y (0 = top), the hand counts as "at rest". */
  restY: number;
  /** Refractory period after a commit, so one pose cannot fire twice. */
  repeatBlockMs: number;
}

export const DEFAULT_DWELL: DwellConfig = {
  confidenceThreshold: 0.65,
  dwellMs: 600,
  autoSpaceMs: 900,
  smoothingWindow: 5,
  restY: 0.82,
  repeatBlockMs: 250,
};

export type DwellEvent =
  | { type: 'idle' }
  | { type: 'tracking'; label: string; confidence: number; progress: number }
  | { type: 'commit'; label: string; confidence: number }
  | { type: 'space' };

export interface DwellInput {
  /** Winning label this frame, or null when no hand / nothing above the floor. */
  label: string | null;
  confidence: number;
  /** Normalized y of the hand centroid, 0..1. Undefined when no hand is present. */
  handY?: number;
  t: number;
}

export class DwellCommitter {
  private config: DwellConfig;
  private votes: (string | null)[] = [];
  private current: string | null = null;
  private heldSince = 0;
  private lastCommitAt = -Infinity;
  private lastCommitted: string | null = null;
  private lastHandSeenAt = 0;
  private spaceArmed = false;

  constructor(config: Partial<DwellConfig> = {}) {
    this.config = { ...DEFAULT_DWELL, ...config };
  }

  update(config: Partial<DwellConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.votes.length > this.config.smoothingWindow) {
      this.votes = this.votes.slice(-this.config.smoothingWindow);
    }
  }

  get settings(): Readonly<DwellConfig> {
    return this.config;
  }

  reset(): void {
    this.votes = [];
    this.current = null;
    this.heldSince = 0;
    this.lastCommitted = null;
    this.spaceArmed = false;
  }

  /** Call once per frame. Returns what the UI should do with this frame. */
  feed(input: DwellInput): DwellEvent {
    const { confidenceThreshold, dwellMs, autoSpaceMs, smoothingWindow, restY, repeatBlockMs } =
      this.config;

    const handPresent = input.handY !== undefined;
    const atRest = handPresent && input.handY! > restY;

    if (handPresent && !atRest) {
      this.lastHandSeenAt = input.t;
      this.spaceArmed = true;
    }

    // Auto-space: the hand left the frame or dropped to rest for long enough.
    if ((!handPresent || atRest) && this.spaceArmed) {
      if (input.t - this.lastHandSeenAt >= autoSpaceMs) {
        this.spaceArmed = false;
        this.reset();
        return { type: 'space' };
      }
    }

    if (!handPresent) {
      this.votes.push(null);
      if (this.votes.length > smoothingWindow) this.votes.shift();
      this.current = null;
      return { type: 'idle' };
    }

    const accepted = input.label && input.confidence >= confidenceThreshold ? input.label : null;
    this.votes.push(accepted);
    if (this.votes.length > smoothingWindow) this.votes.shift();

    const winner = majority(this.votes);
    if (winner === null) {
      this.current = null;
      return { type: 'idle' };
    }

    if (winner !== this.current) {
      this.current = winner;
      this.heldSince = input.t;
    }

    // A different letter clears the repeat block, so "LL" still needs a real
    // gap but "AB" commits back to back.
    if (winner !== this.lastCommitted) this.lastCommitAt = -Infinity;

    const held = input.t - this.heldSince;
    const sinceCommit = input.t - this.lastCommitAt;

    if (held >= dwellMs && sinceCommit >= repeatBlockMs) {
      this.lastCommitAt = input.t;
      this.lastCommitted = winner;
      this.heldSince = input.t;
      this.votes = [];
      return { type: 'commit', label: winner, confidence: input.confidence };
    }

    return {
      type: 'tracking',
      label: winner,
      confidence: input.confidence,
      progress: Math.min(1, held / dwellMs),
    };
  }
}

function majority(votes: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  let nulls = 0;
  for (const v of votes) {
    if (v === null) nulls++;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  // A label needs more votes than the abstentions, otherwise a mostly-empty
  // window would commit on two stray frames.
  return bestCount > nulls ? best : null;
}
