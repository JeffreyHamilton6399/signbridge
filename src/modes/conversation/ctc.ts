/**
 * CTC decoding for continuous sign recognition (Phase 4, experimental).
 *
 * READ THIS BEFORE TRUSTING ANYTHING THIS FILE PRODUCES.
 * Continuous ASL recognition is an open research problem. Published
 * sentence-level systems score well below usable accuracy on unconstrained
 * input, and this decoder does not change that - it is the plumbing that a
 * trained temporal encoder would need, nothing more. Conversation mode ships
 * off by default, behind an "Experimental" flag, and is built to fail visibly.
 *
 * The decoder itself is standard: blank-collapsing greedy decode, plus a small
 * beam search for when a language model prior is available.
 */

export const BLANK = 0;

export interface DecodedGloss {
  gloss: string;
  /** Mean per-frame probability of the frames that produced this token. */
  confidence: number;
  /** Frame indices [start, end) this token spans, for the alignment view. */
  span: [number, number];
}

/**
 * Greedy (best-path) CTC decode.
 *
 * @param logProbs  frames x classes, already log-softmaxed
 * @param labels    class index -> gloss; index 0 must be the blank
 */
export function greedyDecode(
  logProbs: Float32Array,
  frames: number,
  classes: number,
  labels: readonly string[],
): DecodedGloss[] {
  const out: DecodedGloss[] = [];
  let previous = -1;
  let runStart = 0;
  let runProbSum = 0;
  let runLength = 0;

  const flush = (end: number) => {
    if (previous > BLANK && runLength > 0) {
      out.push({
        gloss: labels[previous] ?? `<${previous}>`,
        confidence: Math.exp(runProbSum / runLength),
        span: [runStart, end],
      });
    }
  };

  for (let t = 0; t < frames; t++) {
    let best = 0;
    let bestValue = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = logProbs[t * classes + c];
      if (v > bestValue) {
        bestValue = v;
        best = c;
      }
    }

    if (best !== previous) {
      flush(t);
      previous = best;
      runStart = t;
      runProbSum = 0;
      runLength = 0;
    }
    runProbSum += bestValue;
    runLength++;
  }
  flush(frames);

  return out;
}

interface Beam {
  prefix: number[];
  /** Log probability of paths ending in blank. */
  pBlank: number;
  /** Log probability of paths ending in a non-blank. */
  pNonBlank: number;
}

function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const max = Math.max(a, b);
  return max + Math.log(Math.exp(a - max) + Math.exp(b - max));
}

/**
 * Prefix beam search. Slower than greedy but noticeably better on hesitant
 * signing, where the peak class flickers between a gloss and blank.
 *
 * @param languageModel optional log-prior over the next gloss given the prefix
 */
export function beamDecode(
  logProbs: Float32Array,
  frames: number,
  classes: number,
  labels: readonly string[],
  beamWidth = 12,
  languageModel?: (prefix: string[], next: string) => number,
): DecodedGloss[] {
  let beams: Beam[] = [{ prefix: [], pBlank: 0, pNonBlank: -Infinity }];

  for (let t = 0; t < frames; t++) {
    const next = new Map<string, Beam>();

    const put = (prefix: number[], pBlank: number, pNonBlank: number) => {
      const key = prefix.join(',');
      const existing = next.get(key);
      if (existing) {
        existing.pBlank = logAdd(existing.pBlank, pBlank);
        existing.pNonBlank = logAdd(existing.pNonBlank, pNonBlank);
      } else {
        next.set(key, { prefix, pBlank, pNonBlank });
      }
    };

    for (const beam of beams) {
      const total = logAdd(beam.pBlank, beam.pNonBlank);
      const last = beam.prefix[beam.prefix.length - 1];

      // Extend with blank: prefix unchanged.
      put(beam.prefix, total + logProbs[t * classes + BLANK], -Infinity);

      for (let c = 1; c < classes; c++) {
        const p = logProbs[t * classes + c];
        if (c === last) {
          // Repeat of the same label without an intervening blank collapses.
          put(beam.prefix, -Infinity, beam.pNonBlank + p);
          const extended = [...beam.prefix, c];
          put(extended, -Infinity, beam.pBlank + p + lmScore(languageModel, beam.prefix, labels, c));
        } else {
          const extended = [...beam.prefix, c];
          put(extended, -Infinity, total + p + lmScore(languageModel, beam.prefix, labels, c));
        }
      }
    }

    beams = [...next.values()]
      .sort((a, b) => logAdd(b.pBlank, b.pNonBlank) - logAdd(a.pBlank, a.pNonBlank))
      .slice(0, beamWidth);
  }

  const best = beams[0];
  if (!best) return [];
  const score = logAdd(best.pBlank, best.pNonBlank);
  const confidence = Math.exp(score / Math.max(1, frames));
  return best.prefix.map((c, i) => ({
    gloss: labels[c] ?? `<${c}>`,
    confidence,
    span: [i, i + 1] as [number, number],
  }));
}

function lmScore(
  lm: ((prefix: string[], next: string) => number) | undefined,
  prefix: number[],
  labels: readonly string[],
  next: number,
): number {
  if (!lm) return 0;
  return lm(
    prefix.map((c) => labels[c] ?? ''),
    labels[next] ?? '',
  );
}
