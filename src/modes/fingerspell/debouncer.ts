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
  /**
   * The full per-letter distribution for this frame, when the caller has one.
   *
   * Supplying it switches the smoothing window from voting on hard labels to
   * averaging the distributions, which is strictly better evidence. Voting
   * throws away everything except each frame's winner, so five frames that all
   * said "T at 0.34, A at 0.33" cast five votes for A and none for T; averaging
   * keeps the near-tie visible and lets the frames that *are* decisive settle
   * it. In the fist cluster, where the margins are tiny by nature, this is the
   * difference between a letter that flickers and one that holds.
   *
   * Optional so callers with only a label — tests, replay tools — still work.
   */
  distribution?: Record<string, number>;
  /** Normalized y of the hand centroid, 0..1. Undefined when no hand is present. */
  handY?: number;
  t: number;
}

export class DwellCommitter {
  private config: DwellConfig;
  private votes: (string | null)[] = [];
  /** Recent distributions, when the caller supplies them. Parallel to `votes`. */
  private history: (Record<string, number> | null)[] = [];
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
      this.history = this.history.slice(-this.config.smoothingWindow);
    }
  }

  get settings(): Readonly<DwellConfig> {
    return this.config;
  }

  reset(): void {
    this.votes = [];
    this.history = [];
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
      this.remember(null, null, smoothingWindow);
      this.current = null;
      return { type: 'idle' };
    }

    const accepted = input.label && input.confidence >= confidenceThreshold ? input.label : null;
    this.remember(accepted, input.distribution ?? null, smoothingWindow);

    // Prefer the averaged distribution when the caller gave us one; fall back
    // to majority voting on hard labels otherwise.
    const smoothed = this.averaged();
    let winner: string | null;
    let confidence: number;
    // Margin over the runner-up, which is what decides how long this has to be
    // held. Null when we only have hard labels to vote on: unknown, not zero.
    let margin: number | null = null;
    if (smoothed) {
      winner = smoothed.confidence >= confidenceThreshold ? smoothed.label : null;
      confidence = smoothed.confidence;
      margin = smoothed.margin;
    } else {
      winner = majority(this.votes);
      confidence = input.confidence;
    }

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
    const required = dwellMs * dwellScale(confidence, margin, confidenceThreshold);

    if (held >= required && sinceCommit >= repeatBlockMs) {
      this.lastCommitAt = input.t;
      this.lastCommitted = winner;
      this.heldSince = input.t;
      this.votes = [];
      this.history = [];
      return { type: 'commit', label: winner, confidence };
    }

    return {
      type: 'tracking',
      label: winner,
      confidence,
      // Progress against the *actual* requirement, so the commit animation
      // tracks what is really about to happen rather than a nominal 600ms.
      progress: Math.min(1, held / Math.max(1, required)),
    };
  }

  private remember(
    label: string | null,
    distribution: Record<string, number> | null,
    window: number,
  ): void {
    this.votes.push(label);
    this.history.push(distribution);
    while (this.votes.length > window) this.votes.shift();
    while (this.history.length > window) this.history.shift();
  }

  /**
   * Mean probability per letter across the window, and its winner.
   *
   * Frames with no distribution — no hand, or a caller that does not supply one
   * — count as zeros rather than being skipped. That is the point: a letter
   * seen in two frames out of five cannot average above 0.4, so a hand that is
   * only intermittently tracked never accumulates enough evidence to commit.
   * Returns null when the window holds no distributions at all, which is the
   * signal to fall back to hard-label voting.
   */
  private averaged(): { label: string; confidence: number; margin: number } | null {
    const totals = new Map<string, number>();
    let seen = 0;
    for (const dist of this.history) {
      if (!dist) continue;
      seen++;
      for (const [label, p] of Object.entries(dist)) {
        totals.set(label, (totals.get(label) ?? 0) + p);
      }
    }
    if (seen === 0) return null;

    let best: string | null = null;
    let bestTotal = 0;
    let runnerUp = 0;
    for (const [label, total] of totals) {
      if (total > bestTotal) {
        runnerUp = bestTotal;
        best = label;
        bestTotal = total;
      } else if (total > runnerUp) {
        runnerUp = total;
      }
    }
    if (best === null) return null;
    const n = this.history.length;
    return { label: best, confidence: bestTotal / n, margin: (bestTotal - runnerUp) / n };
  }
}

/**
 * How long this letter actually has to be held, given how sure we are of it.
 *
 * `dwellMs` is a fixed wait, and a fixed wait is the wrong shape for what it is
 * doing. The dwell exists to accumulate evidence: it is there because the
 * classifier flickers between neighbours, and holding still lets the flicker
 * average out. But when a letter arrives at 0.95 with nothing else within 0.5 of
 * it, there is no flicker to average — the evidence arrived complete, and
 * spending another 600ms on it is dead time the user feels on every single
 * letter of every single word.
 *
 * So the wait scales with the evidence, between 40% and 150% of the configured
 * dwell. A clean B commits in about 240ms instead of 600ms; a T sitting 0.03
 * above an A waits 900ms, which is longer than it used to and is the right
 * answer for the case that actually goes wrong.
 *
 * Two things this deliberately does **not** do:
 *
 * It does not lower the confidence threshold. A letter still has to clear the
 * user's bar to accumulate any dwell at all; this only changes how long it must
 * stay there. Speed is bought from the letters that were never in doubt, not by
 * accepting worse evidence.
 *
 * It does not go below `MIN_SCALE`. Some hold is needed regardless — a hand
 * passing through a pose on its way to another one can be briefly, genuinely
 * unambiguous, and committing on that would turn transitions into letters.
 */
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 1.5;

export function dwellScale(confidence: number, margin: number | null, threshold: number): number {
  // No distribution to compare against means no information about how close the
  // race was — and 'no information' has to mean the configured dwell, unchanged.
  // Reading it as 'assume the worst' would quietly make every label-only caller
  // half a second slower than it asked to be.
  if (margin === null) return 1;
  // How far past the bar, as a fraction of the room available above it.
  const headroom = Math.max(1e-3, 1 - threshold);
  const overThreshold = Math.min(1, Math.max(0, (confidence - threshold) / headroom));
  // A margin of 0.4 over the runner-up is decisive; below ~0.05 it is a tie.
  const decisive = Math.min(1, Math.max(0, margin / 0.4));
  // Both have to be good to earn the discount. A high-confidence letter in a
  // near-tie is exactly the fist cluster, where hurrying is how it gets things
  // wrong, so the weaker of the two governs.
  const evidence = Math.min(overThreshold, decisive);
  return MAX_SCALE + (MIN_SCALE - MAX_SCALE) * evidence;
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
