/**
 * Stable identity for tracked hands.
 *
 * MediaPipe reports each frame independently: it gives you a list of hands and
 * a Left/Right label per hand, with no promise that the hand at index 0 this
 * frame is the hand that was at index 0 last frame, and no promise that the
 * label is even the same. Both do change in practice — the label flips when a
 * hand rotates, when it is partly out of frame, or when the two hands cross —
 * and every consumer downstream had quietly been assuming they do not:
 *
 *   - the 1€ filter keyed its state on the handedness label, so a flip threw
 *     away the filter history and let a frame of raw jitter through
 *   - the overlay refuses to extrapolate when the labels disagree between
 *     frames, so a flip showed up as the skeleton stalling
 *   - `pickHand` in auto mode chose whichever hand had the higher handedness
 *     score, which can swap mid-word and read the wrong hand
 *
 * So identity is established once, here, before anything else looks at a frame.
 * Hands are matched to the previous frame by wrist position — they simply
 * cannot move far in 33ms — and each track carries its own accumulated evidence
 * about which physical hand it is. The reported label is that accumulated
 * verdict, not this frame's guess, which is what stops it flickering.
 */
import type { Handedness, HandFrame, VisionFrame } from './types';
import { HAND_LANDMARK } from './types';

/**
 * Furthest a wrist may move between frames and still be the same hand, in
 * normalized image units. A hand crossing the whole frame takes about half a
 * second, so at 30fps 0.18 is generous — but generous is right, because the
 * alternative to a slightly loose match is a spurious new track.
 */
const MAX_MATCH_DISTANCE = 0.18;

/** A track not seen for this long is retired rather than reacquired. */
const TRACK_TIMEOUT_MS = 400;

/**
 * Weight of one frame's handedness reading against the accumulated verdict.
 *
 * Low, on purpose: MediaPipe is right about handedness most of the time, so the
 * verdict should be hard to shift and easy to confirm. Roughly a dozen
 * consistent frames — under half a second — to overturn a settled label.
 */
const HANDEDNESS_INERTIA = 0.12;

interface Track {
  id: number;
  x: number;
  y: number;
  lastSeen: number;
  /** Running evidence in favour of 'Right', 0..1. */
  rightness: number;
}

export class HandTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  /** Returns the frame with `id` filled in and handedness stabilised. */
  track(frame: VisionFrame): VisionFrame {
    if (frame.hands.length === 0) {
      this.expire(frame.t);
      return frame;
    }

    const observations = frame.hands.map((hand) => ({
      hand,
      wrist: hand.landmarks[HAND_LANDMARK.WRIST],
    }));

    // Greedy nearest-match. With at most two hands the optimal assignment and
    // the greedy one agree except in the pathological case where both hands sit
    // on top of each other, and there the answer is arbitrary anyway.
    const pairs: { observation: (typeof observations)[number]; track: Track; d: number }[] = [];
    for (const observation of observations) {
      for (const track of this.tracks) {
        if (frame.t - track.lastSeen > TRACK_TIMEOUT_MS) continue;
        const d = Math.hypot(observation.wrist.x - track.x, observation.wrist.y - track.y);
        if (d <= MAX_MATCH_DISTANCE) pairs.push({ observation, track, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const claimedTracks = new Set<number>();
    const assigned = new Map<(typeof observations)[number], Track>();
    for (const pair of pairs) {
      if (assigned.has(pair.observation) || claimedTracks.has(pair.track.id)) continue;
      assigned.set(pair.observation, pair.track);
      claimedTracks.add(pair.track.id);
    }

    const hands: HandFrame[] = observations.map((observation) => {
      let track = assigned.get(observation);
      if (!track) {
        track = {
          id: this.nextId++,
          x: observation.wrist.x,
          y: observation.wrist.y,
          lastSeen: frame.t,
          // A new track starts at whatever this frame says, with no inertia:
          // there is nothing yet to be loyal to.
          rightness: observation.hand.handedness === 'Right' ? 1 : 0,
        };
        this.tracks.push(track);
      } else {
        track.x = observation.wrist.x;
        track.y = observation.wrist.y;
        track.lastSeen = frame.t;
        // Weight this frame's vote by how sure the detector was about it, so a
        // hesitant reading barely moves a settled verdict.
        const vote = observation.hand.handedness === 'Right' ? 1 : 0;
        const weight = HANDEDNESS_INERTIA * clamp01(observation.hand.handednessScore);
        track.rightness += (vote - track.rightness) * weight;
      }

      const handedness: Handedness = track.rightness >= 0.5 ? 'Right' : 'Left';
      return {
        ...observation.hand,
        id: track.id,
        handedness,
        // Report how settled the verdict is, not how sure one frame was. A hand
        // whose label has been flip-flopping should not claim 98% confidence.
        handednessScore: Math.abs(track.rightness - 0.5) * 2,
      };
    });

    this.expire(frame.t);
    return { ...frame, hands };
  }

  private expire(now: number): void {
    this.tracks = this.tracks.filter((track) => now - track.lastSeen <= TRACK_TIMEOUT_MS);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
